from __future__ import annotations

import logging
from datetime import timedelta

import aiohttp
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import CONF_SCAN_INTERVAL, CONF_URL, DEFAULT_SCAN_INTERVAL, DOMAIN

_LOGGER = logging.getLogger(__name__)
PLATFORMS = ["sensor", "button"]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    conf = {**entry.data, **entry.options}
    url = conf[CONF_URL].rstrip("/")
    interval = conf.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)

    coordinator = StockManagerCoordinator(hass, url, interval)
    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    return True


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return ok


class StockManagerCoordinator(DataUpdateCoordinator):
    def __init__(self, hass: HomeAssistant, url: str, interval: int) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(seconds=interval),
        )
        self.url = url

    async def _async_update_data(self):
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{self.url}/api/inventory", timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    resp.raise_for_status()
                    products = await resp.json()
                async with session.get(f"{self.url}/api/categories", timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    resp.raise_for_status()
                    categories = await resp.json()
                async with session.get(f"{self.url}/api/locations", timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    resp.raise_for_status()
                    locations = await resp.json()
            cat_map = {c["id"]: c["name"] for c in categories}
            loc_map = {l["id"]: l["name"] for l in locations}
            return {"products": products, "cat_map": cat_map, "loc_map": loc_map}
        except Exception as err:
            raise UpdateFailed(f"Stock Manager API error: {err}") from err

    async def async_use(self, product_id: str, quantity: int = 1) -> None:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.url}/api/inventory/use",
                json={"product_id": product_id, "quantity": quantity},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                resp.raise_for_status()
        await self.async_request_refresh()

    async def async_add(self, product_id: str, quantity: int = 1) -> None:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.url}/api/inventory/add",
                json={"product_id": product_id, "quantity": quantity},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                resp.raise_for_status()
        await self.async_request_refresh()
