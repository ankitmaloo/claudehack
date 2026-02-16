"""Firebase integration for RL Harness."""

from typing import Optional, TYPE_CHECKING

import firebase_admin
from firebase_admin import credentials, firestore

if TYPE_CHECKING:
    from verif.harness import RunResult


# --- Firebase Initialization ---
cred = credentials.Certificate("creds/cliokwh-firebase.json")
firebase_admin.initialize_app(cred)
db = firestore.client(database_id='ckwh')


# --- Helper Functions ---

def sanitize(obj):
    """Recursively strip None values (Firestore rejects them)."""
    if obj is None:
        return None
    if obj is firestore.SERVER_TIMESTAMP:                                                                                                                    
        return obj 
    if isinstance(obj, list):
        return [sanitize(item) for item in obj]
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items() if v is not None}
    return obj


def save_run_doc(
    run_id: str,
    task: str,
    user_id: str,
    mode: str = "standard",
    provider: str = "gemini",
    rubric: Optional[str] = None,
    result: Optional["RunResult"] = None,
    status: str = "executing",
    error: Optional[str] = None,
    is_initial: bool = False,
):
    """Save/update run document fields. No events — those go to subcollection."""
    from verif.harness import RunResult  # noqa: F811

    doc_ref = db.collection("runs").document(run_id)

    data = {
        "userId": user_id,
        "task": task,
        "status": status,
        "mode": mode,
        "provider": provider,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    }

    if is_initial:
        data["createdAt"] = firestore.SERVER_TIMESTAMP

    if rubric:
        data["rubric"] = rubric
    if error:
        data["error"] = error
    if result:
        data["result"] = {
            "task": result.task,
            "answer": result.answer,
            "rubric": result.rubric,
        }

    doc_ref.set(sanitize(data), merge=True)


def save_event_categories(run_id: str, categories: dict[str, dict]):
    """Write category docs to runs/{runId}/events/{category}."""
    events_col = db.collection("runs").document(run_id).collection("events")
    for doc_id, data in categories.items():
        data["createdAt"] = firestore.SERVER_TIMESTAMP
        events_col.document(doc_id).set(sanitize(data))
