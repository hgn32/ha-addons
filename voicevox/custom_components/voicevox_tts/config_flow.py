from __future__ import annotations

import aiohttp
import voluptuous as vol
from homeassistant import config_entries
from homeassistant.components.zeroconf import ZeroconfServiceInfo

DOMAIN = "voicevox_tts"

SPEAKERS = {
    3: "ずんだもん",
    10: "雨晴はう",
    24: "WhiteCUL",
    46: "小夜/SAYO",
    48: "ナースロボ＿タイプＴ",
    58: "猫使ビィ",
    89: "Voidoll",
}


async def _test_connection(host: str, port: int) -> bool:
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"http://{host}:{port}/version", timeout=aiohttp.ClientTimeout(total=5)
            ) as resp:
                return resp.status == 200
    except Exception:
        return False


class VoicevoxConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    def __init__(self) -> None:
        self._host: str = "127.0.0.1"
        self._port: int = 50021

    async def async_step_zeroconf(self, discovery_info: ZeroconfServiceInfo):
        self._host = discovery_info.host
        self._port = discovery_info.port

        await self.async_set_unique_id(f"{self._host}:{self._port}")
        self._abort_if_unique_id_configured()

        return await self.async_step_zeroconf_confirm()

    async def async_step_zeroconf_confirm(self, user_input=None):
        if user_input is not None:
            return self.async_create_entry(
                title=f"VOICEVOX Engine ({self._host}:{self._port})",
                data={"host": self._host, "port": self._port, "speaker": user_input["speaker"]},
            )
        return self.async_show_form(
            step_id="zeroconf_confirm",
            description_placeholders={"host": self._host, "port": str(self._port)},
            data_schema=vol.Schema({
                vol.Required("speaker", default=10): vol.In(SPEAKERS),
            }),
        )

    async def async_step_user(self, user_input=None):
        errors: dict[str, str] = {}
        if user_input is not None:
            if await _test_connection(user_input["host"], user_input["port"]):
                await self.async_set_unique_id(f"{user_input['host']}:{user_input['port']}")
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title=f"VOICEVOX Engine ({user_input['host']}:{user_input['port']})",
                    data=user_input,
                )
            errors["base"] = "cannot_connect"
        return self.async_show_form(
            step_id="user",
            errors=errors,
            data_schema=vol.Schema({
                vol.Required("host", default="127.0.0.1"): str,
                vol.Required("port", default=50021): int,
                vol.Required("speaker", default=10): vol.In(SPEAKERS),
            }),
        )
