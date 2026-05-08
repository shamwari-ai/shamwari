"""Export the OpenAPI specification from the FastAPI application.

Generates openapi.json at the project root for CI validation,
external consumers, and SDK generation.

Usage:
    python scripts/export_openapi.py            # write
    python scripts/export_openapi.py --check    # CI drift check
"""

import json
import sys
from pathlib import Path

# Add project root to path for imports
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from src.main import app  # noqa: E402


def render() -> str:
    spec = app.openapi()
    return json.dumps(spec, indent=2, sort_keys=True) + "\n"


def main() -> int:
    output_path = project_root / "openapi.json"
    rendered = render()

    if "--check" in sys.argv:
        on_disk = output_path.read_text() if output_path.exists() else ""
        if on_disk != rendered:
            print(
                "openapi.json is out of date. Run `python scripts/export_openapi.py`.",
                file=sys.stderr,
            )
            return 1
        print("openapi.json is up to date.")
        return 0

    output_path.write_text(rendered)
    spec = app.openapi()
    print(f"OpenAPI spec written to {output_path}")
    print(f"  Title: {spec['info']['title']}")
    print(f"  Version: {spec['info']['version']}")
    print(f"  Paths: {len(spec.get('paths', {}))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
