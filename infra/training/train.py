"""
SageMaker training entry point (scikit-learn script mode).

Trains the four single-feature Random-Forest heads exactly as `python code/final.py`
does (RandomForestClassifier(random_state=42), 80/20 split, random_state=42) and writes
to SM_MODEL_DIR, which SageMaker packs into model.tar.gz:

  model.joblib   the four fitted forests
  forest.json    the same forests as plain decision trees, served by the rf-inference Lambda
  metrics.json   accuracy, precision, recall, F1 and the confusion matrix per head

Run locally with --bootstrap to write forest.json for the Lambda to serve before the first job.
"""
import json
import os
import sys

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_score, recall_score
from sklearn.model_selection import train_test_split

HEADS = [("x", "Temperature"), ("y", "Gas"), ("z", "CO2"), ("w", "Pms")]


def export_forest(model):
    """Trees as arrays. A node is a leaf when left == -1; p1 is the leaf's share of class 1.
    Prediction: walk each tree with float32(x) <= threshold, average p1, value = p1 > 0.5."""
    classes = [int(c) for c in model.classes_]
    k = classes.index(1) if 1 in classes else None
    trees = []
    for est in model.estimators_:
        t = est.tree_
        counts = t.value[:, 0, :]
        p1 = [
            round(float(counts[i, k] / counts[i].sum()), 6) if k is not None and t.children_left[i] == -1 else 0
            for i in range(t.node_count)
        ]
        trees.append({
            "left": t.children_left.tolist(),
            "right": t.children_right.tolist(),
            "threshold": [float(v) for v in t.threshold],
            "p1": p1,
        })
    return {"classes": classes, "trees": trees}


def train(data):
    models, metrics = {}, {"rows": int(len(data)), "heads": {}}
    for key, feat in HEADS:
        X, y = data[[feat]].values, data[f"label_{feat}"].astype(int).values
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
        model = RandomForestClassifier(random_state=42).fit(X_train, y_train)
        y_hat = model.predict(X_test)
        tn, fp, fn, tp = (int(v) for v in confusion_matrix(y_test, y_hat, labels=[0, 1]).ravel())
        metrics["heads"][key] = {
            "accuracy": round(float(accuracy_score(y_test, y_hat)), 4),
            "precision": round(float(precision_score(y_test, y_hat, zero_division=0)), 4),
            "recall": round(float(recall_score(y_test, y_hat, zero_division=0)), 4),
            "f1": round(float(f1_score(y_test, y_hat, zero_division=0)), 4),
            "test_rows": int(len(y_test)),
            "tn": tn, "fp": fp, "fn": fn, "tp": tp,
        }
        models[key] = model
    return models, metrics


def forest_doc(models, metrics):
    return {"features": dict(HEADS), "heads": {k: export_forest(m) for k, m in models.items()}, "metrics": metrics}


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    if "--bootstrap" in sys.argv:
        models, metrics = train(pd.read_csv(os.path.join(here, "TK172529.csv")))
        with open(os.path.join(here, "forest-bootstrap.json"), "w") as fh:
            json.dump(forest_doc(models, metrics), fh, separators=(",", ":"))
        print("wrote forest-bootstrap.json")
        sys.exit(0)

    train_dir = os.environ.get("SM_CHANNEL_TRAIN", "/opt/ml/input/data/train")
    model_dir = os.environ.get("SM_MODEL_DIR", "/opt/ml/model")
    models, metrics = train(pd.read_csv(os.path.join(train_dir, "TK172529.csv")))
    for key, m in metrics["heads"].items():
        print(f"head_{key}_accuracy={m['accuracy']}; head_{key}_f1={m['f1']};")

    joblib.dump(models, os.path.join(model_dir, "model.joblib"))
    with open(os.path.join(model_dir, "forest.json"), "w") as fh:
        json.dump(forest_doc(models, metrics), fh, separators=(",", ":"))
    with open(os.path.join(model_dir, "metrics.json"), "w") as fh:
        json.dump(metrics, fh)
    print("training complete", json.dumps(metrics))
