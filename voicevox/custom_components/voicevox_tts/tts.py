from __future__ import annotations

import aiohttp
from homeassistant.components.tts import TextToSpeechEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import DOMAIN


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    async_add_entities([VoicevoxTTSEntity(config_entry)])


class VoicevoxTTSEntity(TextToSpeechEntity):
    def __init__(self, config_entry: ConfigEntry) -> None:
        self._host: str = config_entry.data["host"]
        self._port: int = config_entry.data["port"]
        self._speaker: int = config_entry.data.get("speaker", 10)
        self._attr_unique_id = f"{DOMAIN}_{self._host}_{self._port}"
        self._attr_name = f"VOICEVOX TTS ({self._host}:{self._port})"

    @property
    def supported_languages(self) -> list[str]:
        return ["ja"]

    @property
    def default_language(self) -> str:
        return "ja"

    async def async_get_tts_audio(
        self, message: str, language: str, options: dict | None = None
    ) -> tuple[str, bytes]:
        speaker = (options or {}).get("speaker", self._speaker)
        base = f"http://{self._host}:{self._port}"
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{base}/audio_query",
                params={"text": message, "speaker": speaker},
            ) as resp:
                query = await resp.json()
            async with session.post(
                f"{base}/synthesis",
                params={"speaker": speaker},
                json=query,
            ) as resp:
                audio = await resp.read()
        return "wav", audio
