"""Turn a Pydantic model into a JSON schema that "strict" structured-output modes accept."""

from typing import Any

from pydantic import BaseModel

# Keywords that strict structured-output implementations commonly reject or ignore.
_DROP_KEYS = {"title", "default"}


def strict_json_schema(model: type[BaseModel]) -> dict[str, Any]:
    """Inline ``$ref``s, require every property and forbid extra properties."""
    schema = model.model_json_schema()
    definitions: dict[str, Any] = schema.pop("$defs", {})

    def convert(node: Any) -> Any:
        if isinstance(node, list):
            return [convert(item) for item in node]
        if not isinstance(node, dict):
            return node
        if "$ref" in node:
            name = node["$ref"].rsplit("/", 1)[-1]
            return convert(definitions[name])
        result = {key: convert(value) for key, value in node.items() if key not in _DROP_KEYS}
        if result.get("type") == "object" and "properties" in result:
            result["required"] = list(result["properties"])
            result["additionalProperties"] = False
        return result

    converted: dict[str, Any] = convert(schema)
    return converted
