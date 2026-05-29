FROM voicevox/voicevox_engine:cpu-latest
# FROM voicevox/voicevox_engine:nvidia-amd64-latest
CMD [ "gosu", "user", "/opt/voicevox_engine/run", "--cors_policy_mode", "all", "--cpu_num_threads", "6", "--host", "0.0.0.0","--load_all_models"]
