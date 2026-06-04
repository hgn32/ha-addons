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

    def _build_entities():
        products = coordinator.data["products"]
        entities = []
        for p in products:
            entities.append(StockUseButton(coordinator, p))
            entities.append(StockAddButton(coordinator, p))
        return entities

    entities = _build_entities()
    async_add_entities(entities)

    def _handle_coordinator_update() -> None:
        existing_ids = {e.unique_id for e in entities}
        new = []
        for p in coordinator.data["products"]:
            if f"stock_manager_use_{p['id']}" not in existing_ids:
                new.append(StockUseButton(coordinator, p))
                new.append(StockAddButton(coordinator, p))
        if new:
            async_add_entities(new)
            entities.extend(new)

    entry.async_on_unload(coordinator.async_add_listener(_handle_coordinator_update))


class StockUseButton(CoordinatorEntity, ButtonEntity):
    _attr_icon = "mdi:minus-circle-outline"

    def __init__(self, coordinator: StockManagerCoordinator, product: dict) -> None:
        super().__init__(coordinator)
        self._product_id = product["id"]
        self._attr_unique_id = f"stock_manager_use_{product['id']}"
        self._attr_name = f"在庫消費 {product['name']}"

    async def async_press(self) -> None:
        await self.coordinator.async_use(self._product_id, 1)


class StockAddButton(CoordinatorEntity, ButtonEntity):
    _attr_icon = "mdi:plus-circle-outline"

    def __init__(self, coordinator: StockManagerCoordinator, product: dict) -> None:
        super().__init__(coordinator)
        self._product_id = product["id"]
        self._attr_unique_id = f"stock_manager_add_{product['id']}"
        self._attr_name = f"在庫追加 {product['name']}"

    async def async_press(self) -> None:
        await self.coordinator.async_add(self._product_id, 1)
