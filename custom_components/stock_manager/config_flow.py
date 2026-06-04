from __future__ import annotations

import aiohttp
import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult

from .const import CONF_SCAN_INTERVAL, CONF_URL, DEFAULT_SCAN_INTERVAL, DEFAULT_URL, DOMAIN


async def _test_connection(url: str) -> bool:
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{url.rstrip('/')}/api/inventory", timeout=aiohttp.ClientTimeout(total=10)) as resp:
                return resp.status == 200
    except Exception:
        return False


class StockManagerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None) -> FlowResult:
        errors = {}
        if user_input is not None:
            url = user_input[CONF_URL].rstrip("/")
            if await _test_connection(url):
                await self.async_set_unique_id(url)
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title=f"Stock Manager ({url})",
                    data={
                        CONF_URL: url,
                        CONF_SCAN_INTERVAL: user_input[CONF_SCAN_INTERVAL],
                    },
                )
            errors["base"] = "cannot_connect"

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({
                vol.Required(CONF_URL, default=DEFAULT_URL): str,
                vol.Optional(CONF_SCAN_INTERVAL, default=DEFAULT_SCAN_INTERVAL): vol.All(int, vol.Range(min=30)),
            }),
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return StockManagerOptionsFlow(config_entry)


class StockManagerOptionsFlow(config_entries.OptionsFlow):
    def __init__(self, config_entry):
        self._entry = config_entry

    async def async_step_init(self, user_input=None) -> FlowResult:
        errors = {}
        if user_input is not None:
            url = user_input[CONF_URL].rstrip("/")
            if await _test_connection(url):
                return self.async_create_entry(data={
                    CONF_URL: url,
                    CONF_SCAN_INTERVAL: user_input[CONF_SCAN_INTERVAL],
                })
            errors["base"] = "cannot_connect"

        current = {**self._entry.data, **self._entry.options}
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema({
                vol.Required(CONF_URL, default=current.get(CONF_URL, DEFAULT_URL)): str,
                vol.Optional(CONF_SCAN_INTERVAL, default=current.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)): vol.All(int, vol.Range(min=30)),
            }),
            errors=errors,
        )
