import os
from concurrent.futures import ThreadPoolExecutor

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

from app.main import create_app

TOKEN = "test-only-token-not-a-secret-1234567890"


@pytest.fixture
def client(tmp_path, monkeypatch):
    url = os.environ.get("TEST_DATABASE_URL", f"sqlite:///{tmp_path / 'test.db'}")
    monkeypatch.setenv("DATABASE_URL", url)
    config = Config("alembic.ini")
    command.upgrade(config, "head")
    app = create_app(url, TOKEN)
    with TestClient(app, headers={"Authorization": f"Bearer {TOKEN}"}) as test_client:
        yield test_client
    app.state.engine.dispose()
    command.downgrade(config, "base")


def new_order(client):
    response = client.post("/orders", json={"title": "Inspect synthetic sensor data"})
    assert response.status_code == 201
    return response.json()


def test_authentication_and_validation(client):
    assert client.get("/orders", headers={"Authorization": "Bearer incorrect"}).status_code == 401
    assert client.post("/orders", json={"title": "   "}).status_code == 422
    assert client.post("/orders", json={"title": "X", "status": "completed"}).status_code == 422
    assert client.get("/orders?limit=1000").status_code == 422


def test_persistence_and_transitions(client):
    order = new_order(client)
    endpoint = f"/orders/{order['id']}"
    assert client.get(endpoint).json() == order
    assert client.get("/orders").json() == [order]
    active = client.patch(endpoint + "/status", json={"status": "active", "expected_version": 1})
    assert active.status_code == 200
    assert active.json()["version"] == 2
    assert (
        client.patch(endpoint + "/status", json={"status": "cancelled", "expected_version": 1}).status_code
        == 409
    )
    assert (
        client.patch(endpoint + "/status", json={"status": "completed", "expected_version": 2}).status_code
        == 200
    )
    assert (
        client.patch(endpoint + "/status", json={"status": "active", "expected_version": 3}).status_code
        == 409
    )
    assert client.get(endpoint).json()["status"] == "completed"


def test_missing_record(client):
    assert client.get("/orders/missing").status_code == 404
    assert (
        client.patch("/orders/missing/status", json={"status": "active", "expected_version": 1}).status_code
        == 404
    )


def test_competing_updates(client):
    order = new_order(client)

    def change(status):
        return client.patch(
            f"/orders/{order['id']}/status", json={"status": status, "expected_version": 1}
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(change, ["active", "cancelled"]))
    assert sorted(results) == [200, 409]


def test_requires_explicit_token():
    with pytest.raises(ValueError):
        create_app("sqlite://", "short")
