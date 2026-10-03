import time
from uuid import uuid4

from assistant_backend.agent.provider import ChatCompletionClient
from assistant_backend.agent.runtime import AgentRuntime
from assistant_backend.application.agent_runs import AgentRunService
from assistant_backend.application.tasks import TaskService
from assistant_backend.config import Settings
from assistant_backend.infrastructure.database import make_engine, make_session_factory


def run_worker() -> None:
    settings = Settings()
    engine = make_engine(settings)
    factory = make_session_factory(engine)
    runs = AgentRunService(factory, settings)
    runtime = AgentRuntime(
        runs,
        TaskService(factory),
        ChatCompletionClient(*settings.chat_provider),
        settings,
    )
    worker_id = str(uuid4())
    last_prune = 0.0
    try:
        while True:
            if time.monotonic() - last_prune >= 60:
                runs.prune_events()
                last_prune = time.monotonic()
            run_id = runs.claim_next(worker_id)
            if run_id is None:
                time.sleep(0.1)
                continue
            runtime.execute(run_id, worker_id)
    except KeyboardInterrupt:
        pass
    finally:
        engine.dispose()


if __name__ == "__main__":
    run_worker()
