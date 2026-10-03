"""Regenerate the versioned OpenAPI snapshot from the actual FastAPI app."""

import json
from pathlib import Path

from assistant_backend.config import Settings
from assistant_backend.main import create_app


def main() -> None:
    app = create_app(Settings(_env_file=None))
    target = Path(__file__).resolve().parents[2] / "contracts" / "openapi.json"
    target.write_text(
        json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
