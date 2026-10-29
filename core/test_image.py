"""The image must carry every file Core imports or reads at import time.

A module that exists in the source tree but not in the image passes every other
test and crashes Core at boot, taking auth, the sink, Ground and the Rule 1 check
down with it. This is the test that catches that.
"""

import re
import unittest
from pathlib import Path

HERE = Path(__file__).parent


class Image(unittest.TestCase):
    def copied(self) -> set[str]:
        names: set[str] = set()
        for line in (HERE / "Dockerfile").read_text().splitlines():
            if line.startswith("COPY ") and "requirements" not in line:
                names.update(line.split()[1:-1])
        return names

    def test_every_local_module_main_imports_is_in_the_image(self):
        src = (HERE / "main.py").read_text()
        local = {
            f"{m}.py"
            for m in re.findall(r"^(?:import|from) (\w+)", src, re.M)
            if (HERE / f"{m}.py").exists()
        }
        self.assertTrue(local, "found no local imports; the check is broken")
        self.assertLessEqual(local, self.copied(), local - self.copied())

    def test_every_data_file_a_module_reads_is_in_the_image(self):
        needed = set()
        for py in ("main.py", "replay.py"):
            needed |= set(re.findall(r"[\w.]+\.json", (HERE / py).read_text()))
        self.assertIn("usage_event_fields.json", needed)
        self.assertLessEqual(needed, self.copied(), needed - self.copied())


if __name__ == "__main__":
    unittest.main()
