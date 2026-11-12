"""Small authenticated work-order API with optimistic concurrency."""

import os
import secrets
from enum import Enum
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Integer, String, create_engine, select, update
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column


class Base(DeclarativeBase):
    pass


class WorkOrder(Base):
    __tablename__ = "work_orders"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="queued")
    version: Mapped[int] = mapped_column(Integer, default=1)


class Status(str, Enum):
    queued = "queued"
    active = "active"
    completed = "completed"
    cancelled = "cancelled"


class CreateOrder(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=200)


class ChangeStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Status
    expected_version: int = Field(ge=1)


class OrderView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    title: str
    status: Status
    version: int


TRANSITIONS = {
    "queued": {"active", "cancelled"},
    "active": {"completed", "cancelled"},
    "completed": set(),
    "cancelled": set(),
}


def create_app(database_url: str | None = None, api_token: str | None = None):
    token = api_token or os.environ.get("API_TOKEN", "")
    if len(token) < 32 or not token.isascii():
        raise ValueError("API_TOKEN must contain at least 32 ASCII characters")
    engine = create_engine(database_url or os.environ["DATABASE_URL"], pool_pre_ping=True)
    app = FastAPI(title="Work Orders API", version="1.0.0")
    app.state.engine = engine
    bearer = HTTPBearer(auto_error=False)

    def authenticated(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
        if credentials is None or not secrets.compare_digest(
            credentials.credentials.encode(), token.encode()
        ):
            raise HTTPException(401, "Invalid bearer token", headers={"WWW-Authenticate": "Bearer"})

    def session():
        with Session(engine) as db:
            yield db

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.post("/orders", response_model=OrderView, status_code=201, dependencies=[Depends(authenticated)])
    def create_order(body: CreateOrder, db: Session = Depends(session)):
        order = WorkOrder(id=str(uuid4()), title=body.title, status="queued", version=1)
        db.add(order)
        db.commit()
        db.refresh(order)
        return order

    @app.get("/orders", response_model=list[OrderView], dependencies=[Depends(authenticated)])
    def list_orders(
        limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0), db: Session = Depends(session)
    ):
        return db.scalars(select(WorkOrder).order_by(WorkOrder.id).offset(offset).limit(limit)).all()

    @app.get("/orders/{order_id}", response_model=OrderView, dependencies=[Depends(authenticated)])
    def get_order(order_id: str, db: Session = Depends(session)):
        order = db.get(WorkOrder, order_id)
        if order is None:
            raise HTTPException(404, "Work order not found")
        return order

    @app.patch("/orders/{order_id}/status", response_model=OrderView, dependencies=[Depends(authenticated)])
    def change_status(order_id: str, body: ChangeStatus, db: Session = Depends(session)):
        order = db.get(WorkOrder, order_id)
        if order is None:
            raise HTTPException(404, "Work order not found")
        if order.version != body.expected_version:
            raise HTTPException(409, "Stale version; reload the order")
        if body.status.value not in TRANSITIONS[order.status]:
            raise HTTPException(409, "Invalid status transition")
        result = db.execute(
            update(WorkOrder)
            .where(WorkOrder.id == order_id, WorkOrder.version == body.expected_version)
            .values(status=body.status.value, version=body.expected_version + 1)
            .execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:
            db.rollback()
            raise HTTPException(409, "Concurrent update; reload the order")
        db.commit()
        db.refresh(order)
        return order

    return app
