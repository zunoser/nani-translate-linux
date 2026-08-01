{ self }:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.naniTranslateLinux;
in
{
  options.programs.naniTranslateLinux = {
    enable = lib.mkEnableOption "Nani Translate for Linux";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
      defaultText = lib.literalExpression ''
        inputs.nani-translate-linux.packages.''${pkgs.stdenv.hostPlatform.system}.default
      '';
      description = "Nani Translate Linux package to install.";
    };
  };

  config = lib.mkIf cfg.enable {
    home.packages = [ cfg.package ];
  };
}
