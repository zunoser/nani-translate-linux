"use strict";

const OcrAccuracy = Object.freeze({ Fast: 0, Accurate: 1 });

async function recognize() {
  throw new Error(
    "Nani screenshot OCR is not supported by the unofficial Linux client. " +
      "Text translation remains available.",
  );
}

module.exports = { OcrAccuracy, recognize };
