from __future__ import annotations

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import StockManagerCoordinator
from .const import DOMAIN


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    coordinator: StockManagerCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([ProductsSelect(coordinator, entry.entry_id)])


class ProductsSelect(CoordinatorEntity, SelectEntity):
    """select.products — 品目一覧。選択した product_id が state になる。
    stock_manager.use / stock_manager.add の product_id 指定に使う。
    """

    _attr_icon = "mdi:format-list-bulleted"
    _attr_current_option: str | None = None

    def __init__(self, coordinator: StockManagerCoordinator, entry_id: str) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"stock_manager_products_{entry_id}"
        self._attr_name = "Products"

    @property
    def options(self) -> list[str]:
        return [p["id"] for p in self.coordinator.data["products"]]

    @property
    def extra_state_attributes(self) -> dict:
        products = self.coordinator.data["products"]
        cat_map = self.coordinator.data["cat_map"]
        return {
            "products": [
                {
                    "id": p["id"],
                    "name": p["name"],
                    "quantity": p["quantity"],
                    "category": cat_map.get(p.get("category_id", ""), ""),
                    "piece_count": p.get("piece_count", 1),
                }
                for p in products
            ]
        }

    async def async_select_option(self, option: str) -> None:
        self._attr_current_option = option
        self.async_write_ha_state()
