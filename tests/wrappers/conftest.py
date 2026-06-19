"""Test fixtures for the ralph-hermes-acp wrapper.

The wrapper is an executable script (no .py extension) that normally runs as a
subprocess. To get meaningful line coverage we import it as a module here and
expose it as the `wrapper_mod` fixture, so unit tests can exercise individual
functions directly.
"""
import importlib.machinery
import importlib.util
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
WRAPPER_PATH = REPO_ROOT / "scripts" / "wrappers" / "ralph-acp"


@pytest.fixture(scope="session")
def wrapper_mod():
    # The wrapper has no .py extension, so spec_from_file_location returns
    # None. Use SourceFileLoader directly to load it as a module.
    loader = importlib.machinery.SourceFileLoader("ralph_acp", str(WRAPPER_PATH))
    spec = importlib.util.spec_from_loader("ralph_acp", loader)
    assert spec is not None, "could not build spec for wrapper"
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


@pytest.fixture(autouse=True)
def _reset_activity_global(wrapper_mod):
    """Ensure the module-level _ACTIVITY tracker never leaks between tests."""
    wrapper_mod._reset_activity()
    yield
    wrapper_mod._reset_activity()
