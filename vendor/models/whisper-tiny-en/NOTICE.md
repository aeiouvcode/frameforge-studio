# Whisper tiny.en speech model

- Model: OpenAI Whisper tiny.en (English, 39M parameters).
- License: the openai/whisper GitHub README and LICENSE state the code and weights are MIT (https://github.com/openai/whisper). The Hugging Face model card metadata for openai/whisper-tiny.en lists apache-2.0. The two sources differ; both licenses are permissive, and this notice records both rather than choosing one.
- ONNX export and int8 quantization: onnx-community/whisper-tiny.en, revision 2575352d61be1bf7225cf8f8b268a4678025fc58
  (encoder_model_int8.onnx -> encoder.onnx, decoder_model_int8.onnx -> decoder.onnx).
- tokens.json: id-to-token table derived from that revision's vocab.json plus generation settings.
- FrameForge loads these files only after the user opts in, checks each SHA-256 before use, and runs them on-device with ONNX Runtime Web. No audio leaves the device.
2adcd415dd1ddfdd7a5a55d303a0925612869f7b0f7b810eada6069837128d1d  joined decoder.onnx (cat decoder.onnx.0* > decoder.onnx)
