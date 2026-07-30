from __future__ import annotations

from .models import AdjustmentStep, ToneDimension

MEANINGFUL_DIFFERENCE = 8.0
MAX_ADJUSTMENTS = 3


def _eq_amount(difference: float) -> str:
    return "0.5〜1.0dB" if abs(difference) < 25 else "1.0〜2.0dB"


def _adjustment_for(dimension: ToneDimension) -> AdjustmentStep:
    decrease = dimension.difference > 0
    amount = _eq_amount(dimension.difference)

    if dimension.key == "brightness":
        title = "高域の主張を少し抑える" if decrease else "高域の抜けを少し足す"
        actions = (
            [
                f"Presenceまたは2〜4kHzを{amount}ずつ下げる",
                "High Cutを使っている場合は、カット周波数を少し下げる",
                "Gainを上げすぎていないか確認し、高域だけで解決しない",
            ]
            if decrease
            else [
                f"Presenceまたは2〜4kHzを{amount}ずつ上げる",
                "High Cutが低すぎる場合は、カット周波数を少し上げる",
                "ピックアップ位置やピッキング位置も確認する",
            ]
        )
    elif dimension.key == "body":
        title = "低中域の密度を少し整理する" if decrease else "低中域の芯を少し足す"
        actions = (
            [
                f"250〜500Hzを{amount}ずつ下げる",
                "BassではなくLow Midから調整し、低域全体を細くしすぎない",
                "歪み量が多い場合はGainも少し戻す",
            ]
            if decrease
            else [
                f"250〜500Hzを{amount}ずつ上げる",
                "Low Cutが高すぎる場合は、カット周波数を少し下げる",
                "Bassを先に上げず、音程感が残る低中域から足す",
            ]
        )
    elif dimension.key == "attack":
        title = "ピッキングの角を少し丸める" if decrease else "音の立ち上がりを少し出す"
        actions = (
            [
                "コンプレッサーのAttackを少し速くする",
                f"必要なら2〜4kHzを{amount}だけ下げる",
                "ピッキングの強さを変えず、まず処理側を1項目だけ動かす",
            ]
            if decrease
            else [
                "コンプレッサーのAttackを少し遅くする",
                "コンプレッション量または歪み量を少し減らす",
                f"必要なら2〜4kHzを{amount}だけ上げる",
            ]
        )
    elif dimension.key == "compression":
        title = "ダイナミクスを少し戻す" if decrease else "音量のばらつきを少し整える"
        actions = (
            [
                "コンプレッサーのRatioまたは圧縮量を少し下げる",
                "歪み段を重ねている場合は、後段のGainを少し戻す",
                "メイクアップゲインで音量だけを合わせ、圧縮量と混同しない",
            ]
            if decrease
            else [
                "低いRatioからコンプレッション量を少し増やす",
                "必要なら軽いサチュレーションを1段だけ足す",
                "メイクアップゲインで比較音量を揃える",
            ]
        )
    else:
        title = "歪みのざらつきを少し抑える" if decrease else "倍音の粗さを少し足す"
        actions = (
            [
                "DriveまたはGainを少し下げる",
                "クリッピング段を重ねている場合は、どちらか1段を弱める",
                "高域が同時に強い場合はHigh Cutも少し下げる",
            ]
            if decrease
            else [
                "Driveまたは軽いサチュレーションを少し足す",
                "高域倍音が不足している場合はPresenceもごく少量足す",
                "ノイズを増やすのではなく、歪み量を小刻みに調整する",
            ]
        )

    return AdjustmentStep(
        key=dimension.key,
        label=dimension.label,
        difference=dimension.difference,
        title=title,
        actions=actions,
        verify="1項目だけ変更して再解析し、差が8未満へ近づくか確認します。",
    )


def build_adjustment_plan(dimensions: list[ToneDimension]) -> list[AdjustmentStep]:
    meaningful = [
        dimension
        for dimension in sorted(
            dimensions,
            key=lambda item: abs(item.difference),
            reverse=True,
        )
        if abs(dimension.difference) >= MEANINGFUL_DIFFERENCE
    ]
    return [
        _adjustment_for(dimension)
        for dimension in meaningful[:MAX_ADJUSTMENTS]
    ]
