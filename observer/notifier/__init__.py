import logging
import json
import sys
from aiohttp import web
from aiohttp_apispec import docs, request_schema
from marshmallow import fields

from acapy_agent.core.event_bus import EventBus, Event
from acapy_agent.core.profile import Profile
from acapy_agent.storage.base import BaseStorage
from acapy_agent.admin.request_context import AdminRequestContext
from acapy_agent.messaging.models.openapi import OpenAPISchema

LOGGER = logging.getLogger(__name__)

# --- Schemas ---

class RegisterTokenSchema(OpenAPISchema):
    connection_id = fields.Str(required=True, example="3fa85f64-5717-4562-b3fc-2c963f66afa6")
    token = fields.Str(required=True, example="fcm_token_123...")

# --- Manager ---

class NotifierManager:
    def __init__(self, context):
        self.context = context

    async def on_any_event(self, profile: Profile, event: Event):
        print(profile, event)

    async def on_forward_received(self, profile: Profile, event: Event):
        payload = event.payload
        recipient_key = payload.get("to")
        
        # In a forward event, we need to map the recipient key back to a connection/token
        async with profile.session() as session:
            storage = session.inject(BaseStorage)
            try:
                # We store tokens using the connection_id as the key in this demo
                # Note: In production, you'd map recipient_key -> connection_id -> token
                # For this simulation, we'll try to find any record that matches
                records = await storage.search_records("notifier_token").fetch_all()
                for record in records:
                    token_data = json.loads(record.value)
                    # For now, any forward message triggers the notification for demo purposes
                    await self.send_notification(token_data["token"], {
                        "title": "New Message",
                        "body": "You have a new encrypted message waiting.",
                        "recipient_key": recipient_key
                    })
                    break 
            except Exception as e:
                LOGGER.debug(f"Notifier: Error during token lookup: {e}")

    async def send_notification(self, token: str, data: dict):
        LOGGER.info(f"--- [WAKE UP CALL SENT] ---")
        LOGGER.info(f"Token: {token}")
        LOGGER.info(f"Data: {json.dumps(data, indent=2)}")
        LOGGER.info(f"---------------------------")

# --- Routes ---

@docs(tags=["notifier"], summary="Register a push token for a connection")
@request_schema(RegisterTokenSchema())
async def register_token(request: web.BaseRequest):
    context: AdminRequestContext = request["context"]
    body = await request.json()
    connection_id = body.get("connection_id")
    token = body.get("token")

    async with context.profile.session() as session:
        storage = session.inject(BaseStorage)
        
        # Store the token
        await storage.add_record(
            "notifier_token", 
            connection_id, 
            json.dumps({"token": token}), 
            {"connection_id": connection_id}
        )
        LOGGER.info(f"Notifier: Registered token for connection {connection_id}")
        
    return web.json_response({"status": "ok"})

async def register(app: web.Application):
    """Callback for ACA-Py to register routes."""
    app.add_routes([web.post("/notifier/register-token", register_token)])

# --- Entry Point ---

async def setup(context):
    """
    The entry point for the Notifier plugin.
    """
    LOGGER.info("Initializing Notifier Plugin (Observer)")
    
    # HACK: Alias this module as 'notifier.routes' so ACA-Py's 
    # automatic route discovery finds our 'register' function.
    sys.modules["notifier.routes"] = sys.modules[__name__]

    manager = NotifierManager(context)
    context.injector.bind_instance(NotifierManager, manager)

    event_bus = context.inject(EventBus)
    event_bus.subscribe(r"acapy::forward::received", manager.on_forward_received)

    event_bus.subscribe(r".*", manager.on_any_event)  # TODO XXX
    
    LOGGER.info("Notifier Plugin: Successfully initialized and aliased routes.")
