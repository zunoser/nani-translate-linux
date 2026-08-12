{
  description = "Linux build and packaging environment for Nani Translate";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      supportedSystems = [ "x86_64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
      upstreamPins = builtins.fromJSON (builtins.readFile ./nix/upstream-nani.json);
      electronRuntimeLibraries = pkgs: with pkgs; [
        alsa-lib
        atk
        cairo
        cups
        dbus
        expat
        glib
        gtk3
        libdrm
        libgbm
        libglvnd
        libxkbcommon
        mesa
        nspr
        nss
        pango
        libx11
        libxcomposite
        libxdamage
        libxext
        libxfixes
        libxrandr
        libxtst
      ];
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          electronLibraries = electronRuntimeLibraries pkgs;
          electronLibraryPath = pkgs.lib.makeLibraryPath electronLibraries;
          dlopenLibraryPath = pkgs.lib.makeLibraryPath [ pkgs.libglvnd ];
          naniDmg = pkgs.fetchurl {
            url = upstreamPins.dmg.url;
            hash = upstreamPins.dmg.sri;
          };
          electronZip = pkgs.fetchurl {
            url = "https://github.com/electron/electron/releases/download/v42.5.2/electron-v42.5.2-linux-x64.zip";
            hash = "sha256-aJ1JKIhIVzKF2P0mUnyGhqYmqIugdO+1xIhknyB1gkY=";
          };
          sqliteArchive = pkgs.fetchurl {
            url = "https://github.com/WiseLibs/better-sqlite3/releases/download/v12.11.1/better-sqlite3-v12.11.1-electron-v146-linux-x64.tar.gz";
            hash = "sha256-4gIa7tgN5PFSElJeMFZXVqqueQ5o4yKd9tE0X0OAMiE=";
          };
          nani = pkgs.buildNpmPackage {
            pname = "nani-translate-linux";
            version = upstreamPins.version;
            src = self;

            npmDepsHash = "sha256-L5tUThJHvaiS8wa9btUhzJwuJggQ3a/q/aet5drsoW8=";
            npmInstallFlags = [ "--ignore-scripts" ];
            dontNpmBuild = true;
            dontBuild = true;

            nativeBuildInputs = with pkgs; [
              autoPatchelfHook
              bash
              binutils
              coreutils
              curl
              findutils
              gawk
              gnugrep
              gnutar
              makeWrapper
              p7zip
              patchelf
              unzip
            ];

            dontAutoPatchelf = true;
            doCheck = true;
            checkPhase = ''
              runHook preCheck
              substituteInPlace tests/runtime-packaging.test.mjs \
                --replace-fail "#!/usr/bin/env bash" "#!${pkgs.bash}/bin/bash"
              npm test
              runHook postCheck
            '';

            installPhase = ''
              runHook preInstall

              export HOME="$TMPDIR/home"
              export NANI_ROOT="$PWD"
              export NANI_CACHE_DIR="$TMPDIR/cache"
              export NANI_BUILD_DIR="$TMPDIR/build"
              export NANI_OUTPUT_DIR="$out/opt/nani"
              export NANI_REPORT_DIR="$TMPDIR/reports"
              export NANI_DMG_PATH="${naniDmg}"
              export NANI_DMG_SHA512="${upstreamPins.dmg.sha512}"
              export NANI_VERSION="${upstreamPins.version}"
              export NANI_ELECTRON_ZIP_PATH="${electronZip}"
              export NANI_SQLITE_ARCHIVE_PATH="${sqliteArchive}"
              export NANI_AUTOPATCHELF=1
              export NANI_AUTOPATCHELF_LIBRARY_PATH="${electronLibraryPath}"
              export NANI_AUTOPATCHELF_APPEND_RPATHS="${dlopenLibraryPath}"

              patchShebangs scripts runtime
              bash scripts/build-app.sh

              mkdir -p "$out/bin" "$out/share/applications" "$out/share/icons/hicolor/512x512/apps"
              makeWrapper "$out/opt/nani/start.sh" "$out/bin/nani" \
                --set NANI_APP_DIR "$out/opt/nani" \
                --prefix LD_LIBRARY_PATH : "${pkgs.libglvnd}/lib"
              substitute runtime/nani.desktop.template "$out/share/applications/nani.desktop" \
                --replace-fail "Exec=nani %U" "Exec=$out/bin/nani %U"
              install -m 0644 "$out/opt/nani/resources/icon.png" \
                "$out/share/icons/hicolor/512x512/apps/nani.png"

              runHook postInstall
            '';
          };
        in
        {
          default = nani;
          nani-translate-linux = nani;
        }
      );

      apps = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          nani = self.packages.${system}.default;
          electronLibraries = electronRuntimeLibraries pkgs;
          electronLibraryPath = pkgs.lib.makeLibraryPath electronLibraries;
          dlopenLibraryPath = pkgs.lib.makeLibraryPath [ pkgs.libglvnd ];
          naniDmg = pkgs.fetchurl {
            url = upstreamPins.dmg.url;
            hash = upstreamPins.dmg.sri;
          };
          localBuild = pkgs.writeShellApplication {
            name = "nani-local-build";
            runtimeInputs = electronLibraries ++ (with pkgs; [
              auto-patchelf
              binutils
              coreutils
              curl
              findutils
              gawk
              gnugrep
              gnutar
              nodejs_22
              p7zip
              patchelf
              unzip
            ]);
            text = ''
              export NANI_AUTOPATCHELF=1
              export NANI_AUTOPATCHELF_LIBRARY_PATH="${electronLibraryPath}"
              export NANI_AUTOPATCHELF_APPEND_RPATHS="${dlopenLibraryPath}"
              export NANI_DMG_PATH="${naniDmg}"
              export NANI_DMG_SHA512="${upstreamPins.dmg.sha512}"
              export NANI_VERSION="${upstreamPins.version}"
              exec bash "$PWD/scripts/build-app.sh" "$@"
            '';
          };
        in
        {
          default = {
            type = "app";
            program = "${nani}/bin/nani";
          };
          build = {
            type = "app";
            program = "${localBuild}/bin/nani-local-build";
          };
        }
      );

      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          electronLibraries = electronRuntimeLibraries pkgs;
          electronLibraryPath = pkgs.lib.makeLibraryPath electronLibraries;
          dlopenLibraryPath = pkgs.lib.makeLibraryPath [ pkgs.libglvnd ];
        in
        {
          default = pkgs.mkShell {
            packages = electronLibraries ++ (with pkgs; [
              auto-patchelf
              binutils
              coreutils
              curl
              desktop-file-utils
              findutils
              gawk
              gnugrep
              gnutar
              just
              nodejs_22
              p7zip
              patchelf
              shellcheck
              unzip
            ]);
            shellHook = ''
              export NANI_AUTOPATCHELF=1
              export NANI_AUTOPATCHELF_LIBRARY_PATH="${electronLibraryPath}"
              export NANI_AUTOPATCHELF_APPEND_RPATHS="${dlopenLibraryPath}"
            '';
          };
        }
      );

      homeManagerModules = rec {
        default = import ./nix/home-manager-module.nix { inherit self; };
        nani-translate-linux = default;
      };
    };
}
