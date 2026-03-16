"""Export the OpenAPI specification from the FastAPI application.

Generates openapi.json at the project root for CI validation,
external consumers, and SDK generation.

Usage:
    python scripts/export_openapi.py
"""

import json
import sys
from pathlib import Path

# Add project root to path for imports
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from src.main import app  # noqa: E402

spec = app.openapi()

output_path = project_root / "openapi.json"
with open(output_path, "w") as f:
    json.dump(spec, f, indent=2)
    f.write("\n")

print(f"OpenAPI spec written to {output_path}")
print(f"  Title: {spec['info']['title']}")
print(f"  Version: {spec['info']['version']}")
print(f"  Paths: {len(spec.get('paths', {}))}")
