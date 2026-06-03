"""Plugin manifest schema sanity tests.

Four independent guarantees:

1. `schema/plugin.schema.json` is itself a well-formed JSON Schema
   (Draft 2020-12) and accepts every in-tree `plugins/*/plugin.json`.
2. Each in-tree manifest's `id` matches its parent directory name —
   the loader assumes this and silent drift would break plugin
   discovery.
3. The `license` enum in the schema enforces AGPL-3.0-only for
    contributed manifests.
4. The schema accepts capability-pipelines.v1 manifest metadata so
    native capability declarations stay first-class in tooling.
"""

from __future__ import annotations

import ast
import glob
import json
import re
from pathlib import Path

import jsonschema
import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = REPO_ROOT / "schema" / "plugin.schema.json"
DOCS_SCHEMA_PATH = REPO_ROOT / "docs" / "plugin-manifest.schema.json"
CONTRIBUTING_PATH = REPO_ROOT / "CONTRIBUTING.md"
PLUGINS_GLOB = str(REPO_ROOT / "plugins" / "*" / "plugin.json")
BACKEND_CAPABILITIES_PATH = REPO_ROOT / "plugins" / "__init__.py"
FRONTEND_CAPABILITIES_PATH = REPO_ROOT / "static" / "capabilities.js"


@pytest.fixture(scope="module")
def schema() -> dict:
    with SCHEMA_PATH.open() as f:
        return json.load(f)


@pytest.fixture(scope="module")
def docs_schema() -> dict:
    with DOCS_SCHEMA_PATH.open() as f:
        return json.load(f)


def test_schema_is_well_formed(schema: dict) -> None:
    """The schema file must itself validate as a Draft 2020-12 schema."""
    jsonschema.Draft202012Validator.check_schema(schema)


def test_schema_contains_capability_contract(schema: dict) -> None:
    """The published schema must keep capability-pipelines.v1 fields first-class."""
    assert schema["properties"]["standards"]["items"]["type"] == "string"
    assert schema["properties"]["capabilities"]["additionalProperties"]["$ref"] == "#/$defs/capabilityDeclaration"
    declaration = schema["$defs"]["capabilityDeclaration"]
    assert "owner" in declaration["properties"]["roles"]["items"]["enum"]
    assert "provider-coordinator" in declaration["properties"]["kind"]["enum"]
    assert declaration["properties"]["operations"]["items"]["type"] == "string"
    assert declaration["properties"]["requests"]["items"]["type"] == "string"
    assert declaration["properties"]["observes"]["items"]["type"] == "string"
    assert "exclusive-owner" in declaration["properties"]["ownership"]["enum"]
    assert "diagnostic-only" in declaration["properties"]["safety"]["enum"]
    assert "styles" in schema["properties"]
    assert schema["properties"]["styles"]["pattern"].startswith("^assets/")
    assert "pluginRelpath" in schema["$defs"]


def test_docs_schema_capability_contract_matches_ci_schema(schema: dict, docs_schema: dict) -> None:
    """The docs copy and CI schema must not drift on capability vocabulary."""
    def without_descriptions(value):
        if isinstance(value, dict):
            return {key: without_descriptions(item) for key, item in value.items() if key != "description"}
        if isinstance(value, list):
            return [without_descriptions(item) for item in value]
        return value

    for key in ("standards", "capability_api", "capabilities", "ui", "ui_contributions", "runtime_domains", "domains", "settings_schema", "styles", "screen", "script", "routes", "tour", "settings"):
        assert without_descriptions(docs_schema["properties"][key]) == without_descriptions(schema["properties"][key])
    assert without_descriptions(docs_schema["$defs"]["pluginRelpath"]) == without_descriptions(schema["$defs"]["pluginRelpath"])
    assert without_descriptions(docs_schema["$defs"]["domainName"]) == without_descriptions(schema["$defs"]["domainName"])
    assert without_descriptions(docs_schema["$defs"]["capabilityDeclaration"]) == without_descriptions(schema["$defs"]["capabilityDeclaration"])
    assert without_descriptions(docs_schema["$defs"]["domainDeclaration"]) == without_descriptions(schema["$defs"]["domainDeclaration"])
    assert without_descriptions(docs_schema["$defs"]["contributionList"]) == without_descriptions(schema["$defs"]["contributionList"])


def _python_constant_set(name: str) -> set[str]:
    module = ast.parse(BACKEND_CAPABILITIES_PATH.read_text(encoding="utf-8"))
    for node in module.body:
        if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == name for target in node.targets):
            value = ast.literal_eval(node.value)
            return set(value)
    pytest.fail(f"Backend capability constant {name} not found")


def _frontend_constant_set(name: str) -> set[str]:
    text = FRONTEND_CAPABILITIES_PATH.read_text(encoding="utf-8")
    match = re.search(rf"const\s+{re.escape(name)}\s*=\s*new\s+Set\(\s*\[(.*?)\]\s*\)", text, re.S)
    if not match:
        pytest.fail(f"Frontend capability constant {name} not found")
    return set(re.findall(r"['\"]([^'\"]+)['\"]", match.group(1)))


def test_capability_schema_vocabulary_matches_runtime_constants(schema: dict) -> None:
    """Schema enums should evolve with backend and frontend capability validators."""
    declaration = schema["$defs"]["capabilityDeclaration"]["properties"]
    checks = [
        (set(declaration["roles"]["items"]["enum"]), "_VALID_CAPABILITY_ROLES", "VALID_ROLES"),
        (set(declaration["mode"]["enum"]), "_VALID_CAPABILITY_MODES", "VALID_MODES"),
        (set(declaration["compatibility"]["enum"]), "_VALID_CAPABILITY_COMPATIBILITY", "VALID_COMPATIBILITY"),
        (set(declaration["ownership"]["enum"]), "_VALID_CAPABILITY_OWNERSHIP", "VALID_OWNERSHIP"),
        (set(declaration["kind"]["enum"]), "_VALID_CAPABILITY_KINDS", "VALID_DOMAIN_KINDS"),
        (set(declaration["safety"]["enum"]), "_VALID_CAPABILITY_SAFETY", "VALID_SAFETY"),
    ]
    for schema_values, backend_name, frontend_name in checks:
        assert schema_values == _python_constant_set(backend_name)
        assert schema_values == _frontend_constant_set(frontend_name)


@pytest.mark.parametrize("manifest_path", sorted(glob.glob(PLUGINS_GLOB)))
def test_in_tree_manifest_validates(manifest_path: str, schema: dict) -> None:
    """Every plugin.json under plugins/ must pass schema validation."""
    with open(manifest_path) as f:
        manifest = json.load(f)
    jsonschema.validate(manifest, schema)


@pytest.mark.parametrize("manifest_path", sorted(glob.glob(PLUGINS_GLOB)))
def test_in_tree_manifest_id_matches_directory(manifest_path: str) -> None:
    """The `id` field must match the parent directory name."""
    with open(manifest_path) as f:
        manifest = json.load(f)
    expected = Path(manifest_path).parent.name
    assert manifest["id"] == expected, (
        f"Plugin id {manifest['id']!r} in {manifest_path} does not match "
        f"directory name {expected!r}. The loader keys plugin lookup by "
        f"directory; drift would silently break discovery."
    )


def test_capability_manifest_metadata_validates(schema: dict) -> None:
    """Capability-declared manifests should validate alongside runtime loader fields."""
    manifest = {
        "id": "capability_example",
        "name": "Capability Example",
        "version": "0.1.0",
        "license": "AGPL-3.0-only",
        "standards": ["capability-pipelines.v1", "plugin-runtime-idempotent.v1"],
        "script": "screen.js",
        "settings": {"html": "settings.html"},
        "settings_schema": {
            "schema_version": "1",
            "packable_keys": ["enabled"],
        },
        "ui": {
            "settings": [{"id": "capability-example-settings", "region": "plugin-settings", "label": "Capability Example"}],
        },
        "capabilities": {
            "library": {
                "roles": ["provider"],
                "kind": "provider-coordinator",
                "operations": ["query-page", "query-artists", "query-stats"],
                "description": "Provides a browsable library source.",
                "mode": "active",
                "compatibility": "none",
                "ownership": "multi-provider",
                "safety": "safe",
                "version": 1,
            },
            "playback": {
                "roles": ["observer"],
                "observes": ["ready", "stopped"],
                "mode": "active",
                "compatibility": "none",
                "ownership": "observer-only",
                "safety": "safe",
                "version": 1,
            },
        },
    }
    jsonschema.validate(manifest, schema)


def test_current_capability_and_styles_manifests_validate(schema: dict) -> None:
    """Validate real manifests that exercise the capability and styles surfaces."""
    for relpath in [
        "plugins/capability_inspector/plugin.json",
        "plugins/highway_3d/plugin.json",
    ]:
        with (REPO_ROOT / relpath).open() as f:
            jsonschema.validate(json.load(f), schema)


def test_invalid_capability_metadata_fails_schema(schema: dict) -> None:
    """Schema validation should still catch malformed native declarations."""
    manifest = {
        "id": "bad_capability_example",
        "name": "Bad Capability Example",
        "standards": ["capability-pipelines.v1"],
        "capabilities": {
            "library": {
                "roles": ["admin"],
                "mode": "active",
                "compatibility": "none",
                "safety": "safe",
                "version": 1,
            },
        },
    }
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(manifest, schema)


def test_schema_license_enum_requires_agpl_only(schema: dict) -> None:
    """Contributed manifests must not validate with non-AGPL licenses."""
    assert schema["properties"]["license"]["enum"] == ["AGPL-3.0-only"]

    manifest = {"id": "license_example", "name": "License Example", "license": "MIT"}
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(manifest, schema)


def test_plugin_runtime_paths_are_plugin_relative(schema: dict) -> None:
    """Runtime file path fields must reject escapes and URL suffixes."""
    valid = {
        "id": "path_example",
        "name": "Path Example",
        "screen": "screen.html",
        "script": "assets/screen.js",
        "routes": "routes.py",
        "tour": "tours/intro.json",
        "settings": {"html": "settings/settings.html"},
    }
    jsonschema.validate(valid, schema)

    for field in ("screen", "script", "routes", "tour"):
        for bad_path in ("../escape.html", "safe/../escape.html", "/abs.html", "C:/abs.html", "dir\\file.js", "screen.html?x=1", "screen.html#frag", "./screen.html", ".hidden"):
            manifest = {"id": "bad_path_example", "name": "Bad Path Example", field: bad_path}
            with pytest.raises(jsonschema.ValidationError):
                jsonschema.validate(manifest, schema)

    for bad_path in ("../settings.html", "settings/../settings.html", "/settings.html", "settings\\settings.html", "settings.html?x=1", "settings.html#frag", "./settings.html", ".settings.html"):
        manifest = {"id": "bad_settings_path", "name": "Bad Settings Path", "settings": {"html": bad_path}}
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(manifest, schema)
