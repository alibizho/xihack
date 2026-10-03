from typing import Annotated

from fastapi import APIRouter, Depends, Request

from assistant_backend.application.identity import SessionIdentity
from assistant_backend.application.training import TrainingSummaryInput, TrainingSummaryService
from assistant_backend.presentation.auth import get_identity, require_csrf, require_origin


router = APIRouter(prefix="/api/training", tags=["training"])


def get_service(request: Request) -> TrainingSummaryService:
    return request.app.state.training_summary_service


@router.post(
    "/summaries",
    status_code=204,
    dependencies=[Depends(require_origin), Depends(require_csrf)],
)
def save_summary(
    body: TrainingSummaryInput,
    identity: Annotated[SessionIdentity, Depends(get_identity)],
    service: Annotated[TrainingSummaryService, Depends(get_service)],
) -> None:
    service.save(identity.user_id, body)
