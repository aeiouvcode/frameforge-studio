# Whisper small speech model (multilingual, optional)

- Model: OpenAI Whisper small (multilingual, 99 languages, 244M parameters).
- License: the openai/whisper GitHub README and LICENSE say the code and weights are MIT (https://github.com/openai/whisper). The Hugging Face model card metadata for openai/whisper-small lists apache-2.0. The two sources differ. Both licenses are permissive, so this notice records both instead of picking one.
- ONNX export and int8 quantization: onnx-community/whisper-small, revision 36050c46d777d46dc4b5f43f6d90574fc38f8732 (base model openai/whisper-small).
  - encoder_model_int8.onnx is shipped as encoder.onnx.0* (joined SHA-256 2601c9eb2d345c5916d4576d36f663a7c96589740fb2273828c48c3fc2c7db75).
  - decoder_model_merged_int8.onnx is shipped as decoder-merged.onnx.0* (joined SHA-256 ec07c3cbb64172c39791e26ee870a65ac22b458c36722bfe2776b3dbf741e0c9), with the key/value cache.
  - Parts are 10.3 MB because of static-host upload limits; cat encoder.onnx.0* > encoder.onnx rebuilds the original file.
- tokens.json: shared with ../whisper-tiny/tokens.json (Whisper tiny and small use the same tokenizer; checked byte-for-byte against this revision's tokenizer.json).
- FrameForge loads these files only after the user picks a non-English caption language, picks "High accuracy" and taps the download button that shows the size. It checks each joined file's SHA-256 before use, keeps it in this site's private storage (removable from the Captions panel), and runs the model on-device with ONNX Runtime Web. No audio leaves the device.
- Needs roughly 1.5 GB of free memory while running; devices reporting less than 4 GB get a warning.
