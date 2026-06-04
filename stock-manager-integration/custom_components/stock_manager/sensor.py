from __future__ import annotations

from homeassistant.components.sensor import SensorEntity
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
        return [StockSensor(coordinator, p) for p in products]

    entities = _build_entities()
    async_add_entities(entities)

    def _handle_coordinator_update() -> None:
        products = coordinator.data["products"]
        existing_ids = {e.unique_id for e in entities}
        new = [StockSensor(coordinator, p) for p in products if f"stock_manager_{p['id']}" not in existing_ids]
        if new:
            async_add_entities(new)
            entities.extend(new)

    entry.async_on_unload(coordinator.async_add_listener(_handle_coordinator_update))


class StockSensor(CoordinatorEntity, SensorEntity):
    _attr_native_unit_of_measurement = "個"
    _attr_icon = "mdi:package-variant-closed"

    def __init__(self, coordinator: StockManagerCoordinator, product: dict) -> None:
        super().__init__(coordinator)
        self._product_id = product["id"]
        self._attr_unique_id = f"stock_manager_{product['id']}"
        self._attr_name = f"在庫 {product['name']}"

    @property
    def native_value(self):
        for p in self.coordinator.data["products"]:
            if p["id"] == self._product_id:
                return p["quantity"]
        return None

    @property
    def extra_state_attributes(self):
        for p in self.coordinator.data["products"]:
            if p["id"] == self._product_id:
                cat_map = self.coordinator.data["cat_map"]
                return {
                    "product_id": p["id"],
                    "maker": p.get("maker", ""),
                    "volume": p.get("volume", ""),
                    "piece_count": p.get("piece_count", 1),
                    "category": cat_map.get(p.get("category_id", ""), ""),
                    "jan_code": p.get("jan_code", ""),
                }
        return {}
