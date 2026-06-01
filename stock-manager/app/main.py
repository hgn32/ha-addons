import csv
import io
import json
import os
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

DATA_DIR = Path("/config/stock-manager")
IMAGES_DIR = DATA_DIR / "images"

app = FastAPI(title="Stock Manager")


# ---------------------------------------------------------------------------
# Storage helpers
# ---------------------------------------------------------------------------

def _path(name: str) -> Path:
    return DATA_DIR / f"{name}.json"


def _load(name: str) -> list:
    p = _path(name)
    if not p.exists():
        return []
    return json.loads(p.read_text(encoding="utf-8"))


def _save(name: str, data: list) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    _path(name).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _new_id() -> str:
    return str(uuid.uuid4())


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


# ---------------------------------------------------------------------------
# Generic CRUD factory
# ---------------------------------------------------------------------------

def find_by_id(items: list, item_id: str) -> Optional[dict]:
    return next((i for i in items if i["id"] == item_id), None)


def remove_by_id(items: list, item_id: str) -> bool:
    before = len(items)
    items[:] = [i for i in items if i["id"] != item_id]
    return len(items) < before


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

@app.on_event("startup")
def startup():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Static files / SPA
# ---------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    # HA Ingress passes the base path via header; inject it so the SPA can
    # build correct absolute URLs for API calls and static assets.
    ingress_path = request.headers.get("X-Ingress-Path", "").rstrip("/")
    html = (Path(__file__).parent / "static" / "index.html").read_text(encoding="utf-8")
    html = html.replace("__INGRESS_PATH__", ingress_path)
    return HTMLResponse(content=html)


app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")
app.mount("/images", StaticFiles(directory=IMAGES_DIR), name="images")


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------

@app.get("/api/categories")
def list_categories():
    return _load("categories")


@app.post("/api/categories", status_code=201)
def create_category(body: dict):
    items = _load("categories")
    item = {"id": _new_id(), "name": body["name"], "note": body.get("note", ""), "created_at": _now()}
    items.append(item)
    _save("categories", items)
    return item


@app.put("/api/categories/{item_id}")
def update_category(item_id: str, body: dict):
    items = _load("categories")
    item = find_by_id(items, item_id)
    if not item:
        raise HTTPException(404, "Not found")
    item.update({"name": body["name"], "note": body.get("note", "")})
    _save("categories", items)
    return item


@app.delete("/api/categories/{item_id}", status_code=204)
def delete_category(item_id: str):
    items = _load("categories")
    if not remove_by_id(items, item_id):
        raise HTTPException(404, "Not found")
    _save("categories", items)


# ---------------------------------------------------------------------------
# Locations
# ---------------------------------------------------------------------------

@app.get("/api/locations")
def list_locations():
    return _load("locations")


@app.post("/api/locations", status_code=201)
def create_location(body: dict):
    items = _load("locations")
    item = {"id": _new_id(), "name": body["name"], "description": body.get("description", ""), "created_at": _now()}
    items.append(item)
    _save("locations", items)
    return item


@app.put("/api/locations/{item_id}")
def update_location(item_id: str, body: dict):
    items = _load("locations")
    item = find_by_id(items, item_id)
    if not item:
        raise HTTPException(404, "Not found")
    item.update({"name": body["name"], "description": body.get("description", "")})
    _save("locations", items)
    return item


@app.delete("/api/locations/{item_id}", status_code=204)
def delete_location(item_id: str):
    items = _load("locations")
    if not remove_by_id(items, item_id):
        raise HTTPException(404, "Not found")
    _save("locations", items)


# ---------------------------------------------------------------------------
# Suppliers
# ---------------------------------------------------------------------------

@app.get("/api/suppliers")
def list_suppliers():
    return _load("suppliers")


@app.post("/api/suppliers", status_code=201)
def create_supplier(body: dict):
    items = _load("suppliers")
    item = {"id": _new_id(), "name": body["name"], "url": body.get("url", ""), "note": body.get("note", ""), "created_at": _now()}
    items.append(item)
    _save("suppliers", items)
    return item


@app.put("/api/suppliers/{item_id}")
def update_supplier(item_id: str, body: dict):
    items = _load("suppliers")
    item = find_by_id(items, item_id)
    if not item:
        raise HTTPException(404, "Not found")
    item.update({"name": body["name"], "url": body.get("url", ""), "note": body.get("note", "")})
    _save("suppliers", items)
    return item


@app.delete("/api/suppliers/{item_id}", status_code=204)
def delete_supplier(item_id: str):
    items = _load("suppliers")
    if not remove_by_id(items, item_id):
        raise HTTPException(404, "Not found")
    _save("suppliers", items)


# ---------------------------------------------------------------------------
# Products
# ---------------------------------------------------------------------------

@app.get("/api/products")
def list_products():
    return _load("products")


@app.post("/api/products", status_code=201)
async def create_product(
    name: str = Form(...),
    jan_code: str = Form(""),
    amazon_asin: str = Form(""),
    category_id: str = Form(""),
    supplier_id: str = Form(""),
    location_id: str = Form(""),
    note: str = Form(""),
    photo: Optional[UploadFile] = File(None),
):
    items = _load("products")
    item_id = _new_id()
    photo_filename = ""
    if photo and photo.filename:
        ext = Path(photo.filename).suffix.lower()
        photo_filename = f"{item_id}{ext}"
        dest = IMAGES_DIR / photo_filename
        content = await photo.read()
        dest.write_bytes(content)
    item = {
        "id": item_id,
        "name": name,
        "jan_code": jan_code,
        "amazon_asin": amazon_asin,
        "category_id": category_id,
        "supplier_id": supplier_id,
        "location_id": location_id,
        "note": note,
        "photo": photo_filename,
        "created_at": _now(),
    }
    items.append(item)
    _save("products", items)
    return item


@app.put("/api/products/{item_id}")
async def update_product(
    item_id: str,
    name: str = Form(...),
    jan_code: str = Form(""),
    amazon_asin: str = Form(""),
    category_id: str = Form(""),
    supplier_id: str = Form(""),
    location_id: str = Form(""),
    note: str = Form(""),
    photo: Optional[UploadFile] = File(None),
):
    items = _load("products")
    item = find_by_id(items, item_id)
    if not item:
        raise HTTPException(404, "Not found")
    if photo and photo.filename:
        if item.get("photo"):
            old = IMAGES_DIR / item["photo"]
            if old.exists():
                old.unlink()
        ext = Path(photo.filename).suffix.lower()
        photo_filename = f"{item_id}{ext}"
        dest = IMAGES_DIR / photo_filename
        content = await photo.read()
        dest.write_bytes(content)
        item["photo"] = photo_filename
    item.update({
        "name": name,
        "jan_code": jan_code,
        "amazon_asin": amazon_asin,
        "category_id": category_id,
        "supplier_id": supplier_id,
        "location_id": location_id,
        "note": note,
    })
    _save("products", items)
    return item


@app.delete("/api/products/{item_id}", status_code=204)
def delete_product(item_id: str):
    items = _load("products")
    item = find_by_id(items, item_id)
    if not item:
        raise HTTPException(404, "Not found")
    if item.get("photo"):
        photo_path = IMAGES_DIR / item["photo"]
        if photo_path.exists():
            photo_path.unlink()
    remove_by_id(items, item_id)
    _save("products", items)


# ---------------------------------------------------------------------------
# Inventory & Transactions
# ---------------------------------------------------------------------------

def _get_stock(product_id: str) -> int:
    inv = _load("inventory")
    entry = find_by_id(inv, product_id)
    return entry["quantity"] if entry else 0


def _set_stock(product_id: str, quantity: int) -> None:
    inv = _load("inventory")
    entry = find_by_id(inv, product_id)
    if entry:
        entry["quantity"] = quantity
    else:
        inv.append({"id": product_id, "quantity": quantity})
    _save("inventory", inv)


def _add_tx(tx_type: str, product_id: str, quantity: int, note: str, unit_price: float = 0, supplier_id: str = ""):
    txs = _load("transactions")
    txs.append({
        "id": _new_id(),
        "type": tx_type,
        "product_id": product_id,
        "quantity": quantity,
        "unit_price": unit_price,
        "supplier_id": supplier_id,
        "note": note,
        "date": _now(),
    })
    _save("transactions", txs)


@app.get("/api/inventory")
def list_inventory():
    inv = _load("inventory")
    products = _load("products")
    result = []
    for p in products:
        entry = find_by_id(inv, p["id"])
        result.append({**p, "quantity": entry["quantity"] if entry else 0})
    return result


@app.post("/api/inventory/add")
def inventory_add(body: dict):
    product_id = body["product_id"]
    qty = int(body["quantity"])
    if qty <= 0:
        raise HTTPException(400, "quantity must be positive")
    current = _get_stock(product_id)
    _set_stock(product_id, current + qty)
    _add_tx("add", product_id, qty, body.get("note", ""), body.get("unit_price", 0), body.get("supplier_id", ""))
    return {"product_id": product_id, "quantity": current + qty}


@app.post("/api/inventory/use")
def inventory_use(body: dict):
    product_id = body["product_id"]
    qty = int(body["quantity"])
    if qty <= 0:
        raise HTTPException(400, "quantity must be positive")
    current = _get_stock(product_id)
    if current < qty:
        raise HTTPException(400, f"在庫不足 (現在: {current})")
    _set_stock(product_id, current - qty)
    _add_tx("use", product_id, -qty, body.get("note", ""))
    return {"product_id": product_id, "quantity": current - qty}


@app.post("/api/inventory/adjust")
def inventory_adjust(body: dict):
    product_id = body["product_id"]
    qty = int(body["quantity"])
    if qty < 0:
        raise HTTPException(400, "quantity must be >= 0")
    before = _get_stock(product_id)
    _set_stock(product_id, qty)
    diff = qty - before
    _add_tx("adjust", product_id, diff, body.get("note", f"強制メンテ: {before}→{qty}"))
    return {"product_id": product_id, "quantity": qty}


@app.get("/api/transactions")
def list_transactions(product_id: Optional[str] = None):
    txs = _load("transactions")
    if product_id:
        txs = [t for t in txs if t["product_id"] == product_id]
    txs.sort(key=lambda t: t["date"], reverse=True)
    return txs


# ---------------------------------------------------------------------------
# Amazon CSV import
# ---------------------------------------------------------------------------

AMAZON_COLUMNS_JP = {
    "注文日": "order_date",
    "注文番号": "order_id",
    "商品名": "title",
    "カテゴリ": "category",
    "ASIN/ISBN": "asin",
    "数量": "quantity",
    "単価": "unit_price",
}

AMAZON_COLUMNS_EN = {
    "Order Date": "order_date",
    "Order ID": "order_id",
    "Title": "title",
    "Category": "category",
    "ASIN/ISBN": "asin",
    "Quantity": "quantity",
    "Unit Price": "unit_price",
}


def _parse_amazon_csv(content: str) -> list[dict]:
    reader = csv.DictReader(io.StringIO(content))
    headers = reader.fieldnames or []
    col_map = AMAZON_COLUMNS_EN
    if "注文日" in headers or "商品名" in headers:
        col_map = AMAZON_COLUMNS_JP

    rows = []
    for row in reader:
        mapped = {}
        for src, dst in col_map.items():
            mapped[dst] = row.get(src, "").strip()
        if mapped.get("title"):
            rows.append(mapped)
    return rows


@app.post("/api/import/amazon")
async def import_amazon(file: UploadFile = File(...)):
    content_bytes = await file.read()
    try:
        content = content_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        content = content_bytes.decode("shift_jis", errors="replace")

    rows = _parse_amazon_csv(content)
    if not rows:
        raise HTTPException(400, "CSVを解析できませんでした。Amazon注文履歴のCSVか確認してください。")

    products = _load("products")
    results = []

    for row in rows:
        asin = row.get("asin", "")
        title = row.get("title", "")
        try:
            qty = int(float(row.get("quantity", "1") or "1"))
        except ValueError:
            qty = 1
        try:
            price_str = row.get("unit_price", "0").replace(",", "").replace("¥", "").replace("$", "").strip()
            unit_price = float(price_str) if price_str else 0
        except ValueError:
            unit_price = 0

        # find existing product by ASIN
        product = None
        if asin:
            product = next((p for p in products if p.get("amazon_asin") == asin), None)

        if product:
            current = _get_stock(product["id"])
            _set_stock(product["id"], current + qty)
            _add_tx("add", product["id"], qty, f"Amazon購入履歴 注文:{row.get('order_id','')}", unit_price)
            results.append({"status": "added", "product_id": product["id"], "name": product["name"], "qty": qty})
        else:
            # create new product stub
            new_id = _new_id()
            new_product = {
                "id": new_id,
                "name": title or asin or "不明",
                "jan_code": "",
                "amazon_asin": asin,
                "category_id": "",
                "supplier_id": "",
                "location_id": "",
                "note": f"Amazonから自動作成 ({row.get('order_date','')})",
                "photo": "",
                "created_at": _now(),
            }
            products.append(new_product)
            _set_stock(new_id, qty)
            _add_tx("add", new_id, qty, f"Amazon購入履歴 注文:{row.get('order_id','')}", unit_price)
            results.append({"status": "created", "product_id": new_id, "name": new_product["name"], "qty": qty})

    _save("products", products)
    return {"imported": len(results), "results": results}
