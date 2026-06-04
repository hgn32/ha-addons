from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import StockManagerCoordinator
from .const import DOMAIN


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    coordinator: StockManagerCoordinator = hass.data[DOMAIN][entry.entry_id]
    known: set[str] = set()

    def _add_new() -> None:
        new = []
        for p in coordinator.data["products"]:
            pid = p["id"]
            if pid not in known:
                known.add(pid)
                new.append(StockUseButton(coordinator, pid))
                new.append(StockAddButton(coordinator, pid))
        if new:
            async_add_entities(new)

    _add_new()
    entry.async_on_unload(coordinator.async_add_listener(_add_new))


def _name(coordinator: StockManagerCoordinator, product_id: str) -> str:
    for p in coordinator.data["products"]:
        if p["id"] == product_id:
            return p["name"]
    return product_id


class StockUseButton(CoordinatorEntity, ButtonEntity):
    """在庫消費ボタン。button.stock_use_<product_id>"""

    _attr_icon = "mdi:minus-circle-outline"

    def __init__(self, coordinator: StockManagerCoordinator, product_id: str) -> None:
        super().__init__(coordinator)
        self._product_id = product_id
        self._attr_unique_id = f"stock_manager_use_{product_id}"

    @property
    def name(self) -> str:
        return f"在庫消費 {_name(self.coordinator, self._product_id)}"

    @property
    def extra_state_attributes(self) -> dict:
        return {"product_id": self._product_id}

    async def async_press(self) -> None:
        await self.coordinator.async_use(self._product_id, 1)


class StockAddButton(CoordinatorEntity, ButtonEntity):
    """在庫追加ボタン。button.stock_add_<product_id>"""

    _attr_icon = "mdi:plus-circle-outline"

    def __init__(self, coordinator: StockManagerCoordinator, product_id: str) -> None:
        super().__init__(coordinator)
        self._product_id = product_id
        self._attr_unique_id = f"stock_manager_add_{product_id}"

    @property
    def name(self) -> str:
        return f"在庫追加 {_name(self.coordinator, self._product_id)}"

    @property
    def extra_state_attributes(self) -> dict:
        return {"product_id": self._product_id}

    async def async_press(self) -> None:
        await self.coordinator.async_add(self._product_id, 1)
