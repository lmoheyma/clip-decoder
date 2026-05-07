import json
import respx
from httpx import Response
from pathlib import Path
from app.nim.client import NimClient


@respx.mock
async def test_complete_text_returns_parsed_json(tmp_path: Path):
    respx.post("https://example.test/v1/chat/completions").mock(
        return_value=Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps({"answer": "ok", "score": 0.7})
                        }
                    }
                ]
            },
        )
    )
    client = NimClient(api_key="nvapi-test", base_url="https://example.test/v1")
    result = await client.complete_text(
        model="meta/llama-3.3-70b-instruct",
        messages=[{"role": "user", "content": "hi"}],
        json_mode=True,
    )
    assert result == {"answer": "ok", "score": 0.7}


@respx.mock
async def test_analyze_image_sends_image_data_url(tmp_path: Path):
    img = tmp_path / "frame.jpg"
    img.write_bytes(b"\xff\xd8\xff\xd9")  # minimal "jpeg"

    captured = {}

    def handler(request):
        captured["body"] = json.loads(request.content)
        return Response(
            200,
            json={
                "choices": [
                    {"message": {"content": json.dumps({"description": "a corridor"})}}
                ]
            },
        )

    respx.post("https://example.test/v1/chat/completions").mock(side_effect=handler)
    client = NimClient(api_key="nvapi-test", base_url="https://example.test/v1")
    result = await client.analyze_image(
        model="nvidia/cosmos-reason1-7b",
        image_path=img,
        prompt="describe",
        json_mode=True,
    )
    assert result == {"description": "a corridor"}
    user_msg = captured["body"]["messages"][-1]
    assert isinstance(user_msg["content"], list)
    assert any(part.get("type") == "image_url" for part in user_msg["content"])
    assert any(
        "data:image/jpeg;base64," in (part.get("image_url", {}).get("url", ""))
        for part in user_msg["content"]
    )


@respx.mock
async def test_complete_text_retries_on_invalid_json(tmp_path: Path):
    responses = [
        Response(200, json={"choices": [{"message": {"content": "not-json"}}]}),
        Response(
            200,
            json={"choices": [{"message": {"content": json.dumps({"ok": True})}}]},
        ),
    ]
    route = respx.post("https://example.test/v1/chat/completions").mock(
        side_effect=responses
    )
    client = NimClient(api_key="nvapi-test", base_url="https://example.test/v1")
    result = await client.complete_text(
        model="m",
        messages=[{"role": "user", "content": "x"}],
        json_mode=True,
    )
    assert result == {"ok": True}
    assert route.call_count == 2
