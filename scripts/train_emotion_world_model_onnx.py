import argparse
import json
from pathlib import Path


EMOTION_KEYS = ["joy", "sadness", "anger", "fear"]


def load_samples(dataset_path: Path):
    samples = []
    for line in dataset_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            samples.append(json.loads(line))
    if not samples:
        raise ValueError("Dataset is empty.")
    return samples


def emotion_vector(sample, key):
    state = sample[key]
    return [float(state[name]) for name in EMOTION_KEYS]


def main():
    parser = argparse.ArgumentParser(description="Train and export PBK emotional world model to ONNX.")
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--metadata-out", required=True)
    parser.add_argument("--model-id", default="pbk-emotion-world-model")
    args = parser.parse_args()

    import numpy as np
    import torch
    import torch.nn as nn

    samples = load_samples(Path(args.dataset))
    action_types = sorted({str(sample.get("actionType", "")).lower() for sample in samples})
    action_index = {name: index for index, name in enumerate(action_types)}
    input_dim = len(EMOTION_KEYS) + len(action_types)
    output_dim = len(EMOTION_KEYS)

    x_rows = []
    y_rows = []
    for sample in samples:
        action = str(sample.get("actionType", "")).lower()
        action_one_hot = [0.0] * len(action_types)
        action_one_hot[action_index[action]] = 1.0
        x_rows.append(emotion_vector(sample, "currentEmotion") + action_one_hot)
        y_rows.append(emotion_vector(sample, "nextEmotion"))

    x = torch.tensor(np.asarray(x_rows, dtype=np.float32))
    y = torch.tensor(np.asarray(y_rows, dtype=np.float32))

    model = nn.Sequential(
        nn.Linear(input_dim, 16),
        nn.ReLU(),
        nn.Linear(16, output_dim),
        nn.Softmax(dim=-1),
    )
    optimizer = torch.optim.Adam(model.parameters(), lr=0.04)
    loss_fn = nn.MSELoss()

    model.train()
    epochs = max(120, min(1200, len(samples) * 120))
    final_loss = 0.0
    for _ in range(epochs):
        optimizer.zero_grad()
        prediction = model(x)
        loss = loss_fn(prediction, y)
        loss.backward()
        optimizer.step()
        final_loss = float(loss.detach().cpu().item())

    model.eval()
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    dummy_input = torch.zeros(1, input_dim, dtype=torch.float32)
    torch.onnx.export(
        model,
        dummy_input,
        str(out_path),
        input_names=["features"],
        output_names=["nextEmotion"],
        dynamic_axes={"features": {0: "batch"}, "nextEmotion": {0: "batch"}},
        opset_version=17,
    )

    metadata = {
        "ok": True,
        "result": "emotion_world_model_onnx_exported",
        "exporter": "torch.onnx",
        "modelId": args.model_id,
        "onnxPath": str(out_path),
        "sampleCount": len(samples),
        "inputDim": input_dim,
        "outputDim": output_dim,
        "emotionKeys": EMOTION_KEYS,
        "actionTypes": action_types,
        "epochs": epochs,
        "finalLoss": final_loss,
    }
    Path(args.metadata_out).write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        raise
