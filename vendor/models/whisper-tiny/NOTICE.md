# Whisper tiny speech model (multilingual)

- Model: OpenAI Whisper tiny (multilingual, 99 languages, 39M parameters).
- License: the openai/whisper GitHub README and LICENSE say the code and weights are MIT (https://github.com/openai/whisper). The Hugging Face model card metadata for openai/whisper-tiny lists apache-2.0. The two sources differ. Both licenses are permissive, so this notice records both instead of picking one.
- ONNX export and int8 quantization: onnx-community/whisper-tiny, revision ff4177021cc41f7db950912b73ea4fdf7d01d8e7 (base model openai/whisper-tiny).
  - encoder_model_int8.onnx is shipped as encoder.onnx.
  - decoder_model_merged_int8.onnx is shipped as decoder-merged.onnx, with the key/value cache.
- tokens.json: an id-to-token table built from that revision's tokenizer.json and generation_config.json (language and task ids included).
- FrameForge loads these files only after the user picks a non-English caption language and opts in. It checks each file's SHA-256 before use and runs the model on-device with ONNX Runtime Web. No audio leaves the device.
- The joined decoder-merged.onnx (cat decoder-merged.onnx.0* > decoder-merged.onnx) has SHA-256 25e807a962b6349356d0ea5d0dfe530b7e5bf0e2a484aeca0359d03143faddd3.
