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
    known: set[str] = set()

    def _add_new() -> None:
        new = []
        for p in coordinator.data["products"]:
            pid = p["id"]
            if pid not in known:
                known.add(pid)
                new.append(ProductSensor(coordinator, pid))
        if new:
            async_add_entities(new)

    _add_new()
    entry.async_on_unload(coordinator.async_add_listener(_add_new))


class ProductSensor(CoordinatorEntity, SensorEntity):
    """sensor.product_<product_id>
    state = 在庫数、属性に品目情報すべて。entity_picture で画像表示。
    """

    _attr_native_unit_of_measurement = "個"
    _attr_icon = "mdi:package-variant-closed"

    def __init__(self, coordinator: StockManagerCoordinator, product_id: str) -> None:
        super().__init__(coordinator)
        self._product_id = product_id
        self._attr_unique_id = f"stock_manager_product_{product_id}"

    def _product(self) -> dict | None:
        for p in self.coordinator.data["products"]:
            if p["id"] == self._product_id:
                return p
        return None

    @property
    def name(self) -> str:
        p = self._product()
        return p["name"] if p else self._product_id

    @property
    def native_value(self) -> int | None:
        p = self._product()
        return p["quantity"] if p else None

    @property
    def entity_picture(self) -> str | None:
        p = self._product()
        if not p:
            return None
        photo = p.get("photo", "")
        if not photo:
            return None
        if photo.startswith("http"):
            return photo
        return f"{self.coordinator.url}/{photo.lstrip('/')}"

    @property
    def extra_state_attributes(self) -> dict:
        p = self._product()
        if not p:
            return {}
        cat_map = self.coordinator.data["cat_map"]
        loc_map = self.coordinator.data["loc_map"]
        return {
            "product_id": self._product_id,
            "name": p["name"],
            "maker": p.get("maker", ""),
            "volume": p.get("volume", ""),
            "piece_count": p.get("piece_count", 1),
            "category": cat_map.get(p.get("category_id", ""), ""),
            "location": loc_map.get(p.get("location_id", ""), ""),
            "jan_code": p.get("jan_code", ""),
            "amazon_url": p.get("amazon_url", ""),
            "note": p.get("note", ""),
            "quantity": p.get("quantity", 0),
        }
