from __future__ import annotations

import logging
from datetime import timedelta

import aiohttp
import voluptuous as vol
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import CONF_SCAN_INTERVAL, CONF_URL, DEFAULT_SCAN_INTERVAL, DOMAIN

_LOGGER = logging.getLogger(__name__)
PLATFORMS = ["sensor", "select"]

SERVICE_USE = "use"
SERVICE_ADD = "add"
SERVICE_SCHEMA = vol.Schema({
    vol.Required("product_id"): cv.string,
    vol.Optional("quantity", default=1): vol.All(int, vol.Range(min=1)),
})


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    conf = {**entry.data, **entry.options}
    url = conf[CONF_URL].rstrip("/")
    interval = conf.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)

    coordinator = StockManagerCoordinator(hass, url, interval)
    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator

    async def _handle_use(call: ServiceCall) -> None:
        await coordinator.async_post("use", call.data["product_id"], call.data.get("quantity", 1))

    async def _handle_add(call: ServiceCall) -> None:
        await coordinator.async_post("add", call.data["product_id"], call.data.get("quantity", 1))

    hass.services.async_register(DOMAIN, SERVICE_USE, _handle_use, schema=SERVICE_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_ADD, _handle_add, schema=SERVICE_SCHEMA)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    return True


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.services.async_remove(DOMAIN, SERVICE_USE)
    hass.services.async_remove(DOMAIN, SERVICE_ADD)
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return ok


class StockManagerCoordinator(DataUpdateCoordinator):
    def __init__(self, hass: HomeAssistant, url: str, interval: int) -> None:
        super().__init__(hass, _LOGGER, name=DOMAIN, update_interval=timedelta(seconds=interval))
        self.url = url

    async def _async_update_data(self) -> dict:
        try:
            async with aiohttp.ClientSession() as session:
                async def get(path: str) -> list:
                    async with session.get(f"{self.url}{path}", timeout=aiohttp.ClientTimeout(total=10)) as r:
                        r.raise_for_status()
                        return await r.json()

                products, categories, locations = await _gather(
                    get("/api/inventory"),
                    get("/api/categories"),
                    get("/api/locations"),
                )
            return {
                "products": products,
                "cat_map": {c["id"]: c["name"] for c in categories},
                "loc_map": {l["id"]: l["name"] for l in locations},
            }
        except Exception as err:
            raise UpdateFailed(f"API error: {err}") from err

    async def async_post(self, action: str, product_id: str, quantity: int) -> None:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.url}/api/inventory/{action}",
                json={"product_id": product_id, "quantity": quantity},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as r:
                r.raise_for_status()
        await self.async_request_refresh()


async def _gather(*coros):
    import asyncio
    return await asyncio.gather(*coros)
