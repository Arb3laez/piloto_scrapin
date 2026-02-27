"""
Mapper batch para Biowel: transcript completo → filled_fields.

Recibe el transcript completo, la lista de campos (fields) y already_filled.
Aplica reglas determinísticas (sin LLM) para mapear secciones, keywords,
patrones anclados, checkbox, select, radio a sus data-testid correspondientes.

Reglas:
1) Secciones por anchors (keywords que delimitan bloques de texto)
2) Patrones anclados (tiempo de evolución)
3) Checkbox/Radio por keywords positivas/negativas
4) Select por keyword → valor normalizado
5) Respetar already_filled (no sobreescribir)
6) Solo usar data-testid presentes en fields
7) Si no hay match claro, no llenar
"""

import re
import logging
from typing import Dict, List, Optional, Tuple

from app.realtime_extractor import (
    KEYWORD_TO_FIELD,
    KEYWORD_TO_SELECT_VALUE,
    KEYWORD_TO_UNCHECK,
    EVOLUTION_TIME_ANCHORED_RE,
    FIELD_TYPE_OVERRIDES,
    normalize_value,
    clean_captured_value,
)

logger = logging.getLogger(__name__)


# ============================================
# Anchors de sección: keywords que delimitan bloques de texto
# Ordenados por longitud descendente para priorizar matches más específicos.
# Cada anchor mapea a un data-testid de campo textarea/text.
# ============================================
SECTION_ANCHORS: List[Tuple[re.Pattern, str]] = []

_SECTION_ANCHOR_KEYWORDS = {
    "motivo de la consulta": "attention-origin-reason-for-consulting-badge-field",
    "motivo de consulta": "attention-origin-reason-for-consulting-badge-field",
    "consulta por": "attention-origin-reason-for-consulting-badge-field",
    "enfermedad actual": "attention-origin-current-disease-badge-field",
    "padecimiento actual": "attention-origin-current-disease-badge-field",
    "cuadro clínico": "attention-origin-current-disease-badge-field",
    "cuadro clinico": "attention-origin-current-disease-badge-field",
    "justificación": "text-config-justification-textarea",
    "justificacion": "text-config-justification-textarea",
    "observaciones del examen físico": "oftalmology-observations-textarea",
    "observaciones del examen fisico": "oftalmology-observations-textarea",
    "observaciones de examen": "oftalmology-observations-textarea",
    "observaciones examen": "oftalmology-observations-textarea",
    "observaciones": "oftalmology-observations-textarea",
    "análisis y plan de tratamiento": "analysis-and-plan-textarea",
    "analisis y plan de tratamiento": "analysis-and-plan-textarea",
    "análisis y plan": "analysis-and-plan-textarea",
    "analisis y plan": "analysis-and-plan-textarea",
    "análisis": "analysis-and-plan-textarea",
    "analisis": "analysis-and-plan-textarea",
    "plan": "analysis-and-plan-textarea",
}

# Compilar anchors ordenados por longitud descendente (más específico primero)
for kw, testid in sorted(_SECTION_ANCHOR_KEYWORDS.items(), key=lambda x: -len(x[0])):
    pattern = re.compile(r"\b" + re.escape(kw) + r"\b", re.IGNORECASE)
    SECTION_ANCHORS.append((pattern, testid))


# ============================================
# Keywords para checkbox (activar/desactivar)
# ============================================
_CHECKBOX_KEYWORDS: Dict[str, str] = {}
for kw, testid in KEYWORD_TO_FIELD.items():
    if "checkbox" in testid or "switch" in testid:
        _CHECKBOX_KEYWORDS[kw.lower()] = testid

_UNCHECK_KEYWORDS: Dict[str, str] = {
    kw.lower(): testid for kw, testid in KEYWORD_TO_UNCHECK.items()
}

# ============================================
# Keywords para radio buttons
# ============================================
_RADIO_KEYWORDS: Dict[str, str] = {}
for kw, testid in KEYWORD_TO_FIELD.items():
    if "radio" in testid:
        _RADIO_KEYWORDS[kw.lower()] = testid

# ============================================
# Keywords para select
# ============================================
_SELECT_KEYWORDS: Dict[str, str] = {}
for kw, testid in KEYWORD_TO_FIELD.items():
    if "select" in testid and "checkbox" not in testid and not testid.startswith("select-option-"):
        # Excluir botones que parecen selects por nombre pero son clickeables
        if testid in ("text-config-findings-select", "text-config-search-field"):
            continue
        _SELECT_KEYWORDS[kw.lower()] = testid

# ============================================
# Keywords para buttons (click directo)
# Incluye: botones reales, dropdown items, tabs, select-options (clickeables),
# y campos con FIELD_TYPE_OVERRIDES == "button" (ej: ophtalmology-justification-textfield)
# ============================================
_BUTTON_TESTIDS = set()
for testid_override, ftype_override in FIELD_TYPE_OVERRIDES.items():
    if ftype_override == "button":
        _BUTTON_TESTIDS.add(testid_override)

_BUTTON_KEYWORDS: Dict[str, str] = {}
for kw, testid in KEYWORD_TO_FIELD.items():
    if (
        "button" in testid
        or "dropdown-item" in testid
        or "tab-" in testid
        or testid.startswith("select-option-")
        or testid in _BUTTON_TESTIDS
    ):
        _BUTTON_KEYWORDS[kw.lower()] = testid


def _build_field_index(fields: List[Dict]) -> Dict[str, Dict]:
    """Construye un índice rápido de campos por data_testid y unique_key."""
    index = {}
    for f in fields:
        testid = f.get("data_testid", "")
        ukey = f.get("unique_key", "")
        if testid:
            index[testid] = f
        if ukey and ukey != testid:
            index[ukey] = f
    return index


def _field_exists(testid: str, field_index: Dict[str, Dict]) -> bool:
    """Verifica que un data-testid existe en la lista de campos del frontend."""
    return testid in field_index


def _is_already_filled(testid: str, already_filled: Dict[str, str]) -> bool:
    """Verifica si un campo ya está lleno."""
    return testid in already_filled and already_filled[testid] not in ("", None)


def _get_field_type(testid: str, field_index: Dict[str, Dict]) -> str:
    """Obtiene el field_type de un campo dado su testid."""
    f = field_index.get(testid)
    if f:
        return f.get("field_type", "text")
    # Inferir por nombre
    if "checkbox" in testid or "switch" in testid:
        return "checkbox"
    if "radio" in testid:
        return "radio"
    if "select" in testid:
        return "select"
    if "textarea" in testid:
        return "textarea"
    if "button" in testid or "dropdown-item" in testid:
        return "button"
    return "text"


def map_transcript_to_fields(
    transcript: str,
    fields: List[Dict],
    already_filled: Dict[str, str],
) -> Dict[str, str]:
    """
    Mapea un transcript completo a campos Biowel por data-testid.

    Args:
        transcript: Texto completo transcrito.
        fields: Lista de campos del frontend (data_testid, unique_key, label, field_type, options).
        already_filled: Dict de campos ya llenos {data_testid: value}.

    Returns:
        Dict de campos llenados {data_testid: value}.
    """
    if not transcript or not transcript.strip():
        logger.warning("[BatchMapper] Transcript vacío, nada que mapear")
        return {}

    if not fields:
        logger.warning("[BatchMapper] Sin campos, nada que mapear")
        return {}

    field_index = _build_field_index(fields)
    filled: Dict[str, str] = {}
    text_lower = transcript.lower().strip()

    logger.info(
        f"[BatchMapper] Mapeando transcript ({len(transcript)} chars) "
        f"a {len(fields)} campos ({len(already_filled)} ya llenos)"
    )

    # =============================================
    # PASO 1: Patrones anclados (tiempo de evolución)
    # =============================================
    for match in EVOLUTION_TIME_ANCHORED_RE.finditer(text_lower):
        val_num, val_unit = match.groups()

        time_input_key = "attention-origin-evolution-time-input"
        time_unit_key = "attention-origin-evolution-time-unit-select"

        if (
            _field_exists(time_input_key, field_index)
            and not _is_already_filled(time_input_key, already_filled)
            and time_input_key not in filled
        ):
            filled[time_input_key] = val_num.replace(",", ".")

        if (
            _field_exists(time_unit_key, field_index)
            and not _is_already_filled(time_unit_key, already_filled)
            and time_unit_key not in filled
        ):
            filled[time_unit_key] = normalize_value(val_unit, "select")

    logger.info(f"[BatchMapper] Paso 1 (patrones anclados): {len(filled)} campos")

    # =============================================
    # PASO 2: Checkbox / Radio / Select / Button por keywords
    # Recorremos keywords ordenadas por longitud descendente
    # =============================================

    # 2a: Uncheck keywords (negación de checkbox)
    for kw in sorted(_UNCHECK_KEYWORDS.keys(), key=len, reverse=True):
        if kw in text_lower:
            testid = _UNCHECK_KEYWORDS[kw]
            if _field_exists(testid, field_index) and testid not in filled:
                if not _is_already_filled(testid, already_filled):
                    filled[testid] = "false"
                    logger.debug(f"[BatchMapper] Uncheck: '{kw}' → '{testid}' = false")

    # 2b: Checkbox keywords (activar)
    for kw in sorted(_CHECKBOX_KEYWORDS.keys(), key=len, reverse=True):
        if kw in text_lower:
            testid = _CHECKBOX_KEYWORDS[kw]
            if _field_exists(testid, field_index) and testid not in filled:
                if not _is_already_filled(testid, already_filled):
                    # Verificar que no haya negación cercana
                    neg_pattern = re.compile(
                        r"\bno\s+" + re.escape(kw) + r"\b", re.IGNORECASE
                    )
                    if neg_pattern.search(transcript):
                        filled[testid] = "false"
                    else:
                        filled[testid] = "true"
                    logger.debug(f"[BatchMapper] Checkbox: '{kw}' → '{testid}' = {filled[testid]}")

    # 2c: Radio keywords
    for kw in sorted(_RADIO_KEYWORDS.keys(), key=len, reverse=True):
        if kw in text_lower:
            testid = _RADIO_KEYWORDS[kw]
            if _field_exists(testid, field_index) and testid not in filled:
                if not _is_already_filled(testid, already_filled):
                    filled[testid] = "true"
                    logger.debug(f"[BatchMapper] Radio: '{kw}' → '{testid}' = true")

    # 2d: Select keywords
    for kw in sorted(_SELECT_KEYWORDS.keys(), key=len, reverse=True):
        if kw in text_lower:
            testid = _SELECT_KEYWORDS[kw]
            if _field_exists(testid, field_index) and testid not in filled:
                if not _is_already_filled(testid, already_filled):
                    # Obtener valor real del select
                    select_val = KEYWORD_TO_SELECT_VALUE.get(kw, kw)
                    normalized = normalize_value(select_val, "select")
                    filled[testid] = normalized
                    logger.debug(f"[BatchMapper] Select: '{kw}' → '{testid}' = '{normalized}'")

    # 2e: Button keywords (click directo)
    for kw in sorted(_BUTTON_KEYWORDS.keys(), key=len, reverse=True):
        if kw in text_lower:
            testid = _BUTTON_KEYWORDS[kw]
            if _field_exists(testid, field_index) and testid not in filled:
                if not _is_already_filled(testid, already_filled):
                    filled[testid] = "click"
                    logger.debug(f"[BatchMapper] Button: '{kw}' → '{testid}' = click")

    # 2f: Dynamic label-matching para select-option-* (genéricos reutilizables)
    # Los select-option-* cambian de significado según el dropdown abierto.
    # En lugar de keywords hardcodeadas, matcheamos el label que envía el frontend.
    # Recopilar todos los labels de select-option-* para verificar unicidad
    so_labels = {}
    for f in fields:
        testid = f.get("data_testid", "")
        if testid.startswith("select-option-"):
            label = (f.get("label") or "").strip().lower()
            if label and len(label) >= 3:
                so_labels[testid] = label

    for testid, label in so_labels.items():
        if testid in filled:
            continue
        if _is_already_filled(testid, already_filled):
            continue
        # Match exacto del label completo
        if label in text_lower:
            filled[testid] = "click"
            logger.debug(f"[BatchMapper] DynLabel: '{label}' → '{testid}' = click")
            continue
        # Match parcial: buscar fragmentos que sean ÚNICOS entre los labels
        # (evita que "enfermedades del aparato" matchee todas las opciones)
        words = label.split()
        matched = False
        for n in range(len(words), 1, -1):
            fragment = " ".join(words[:n])
            if len(fragment) < 8:
                continue
            if fragment not in text_lower:
                continue
            # Verificar que este fragmento es único (no matchea otros labels)
            other_match = False
            for other_tid, other_label in so_labels.items():
                if other_tid != testid and fragment in other_label:
                    other_match = True
                    break
            if not other_match:
                filled[testid] = "click"
                logger.debug(f"[BatchMapper] DynLabel(unique): '{fragment}' → '{testid}' = click")
                matched = True
                break
        if matched:
            continue

    logger.info(f"[BatchMapper] Paso 2 (keywords): {len(filled)} campos total")

    # =============================================
    # PASO 3: Secciones por anchors → campos textarea/text
    # Dividir el transcript en bloques por anchor y asignar contenido
    # =============================================
    section_assignments = _extract_sections(transcript, field_index, already_filled, filled)
    for testid, content in section_assignments.items():
        if testid not in filled:
            ftype = _get_field_type(testid, field_index)
            normalized = normalize_value(content, ftype)
            if normalized and normalized.strip():
                filled[testid] = normalized

    logger.info(f"[BatchMapper] Paso 3 (secciones): {len(filled)} campos total")

    # =============================================
    # PASO 4: Normalización final y limpieza
    # =============================================
    final_filled = {}
    for testid, value in filled.items():
        if not value or not str(value).strip():
            continue
        # Doble-check: no sobreescribir already_filled
        if _is_already_filled(testid, already_filled):
            continue
        # Buttons se incluyen solo si tienen value="click"
        ftype = _get_field_type(testid, field_index)
        if ftype == "button" and value != "click":
            continue
        final_filled[testid] = str(value)

    logger.info(
        f"[BatchMapper] Resultado final: {len(final_filled)} campos llenados, "
        f"{len(already_filled)} ya estaban llenos"
    )
    return final_filled


def _extract_sections(
    transcript: str,
    field_index: Dict[str, Dict],
    already_filled: Dict[str, str],
    already_mapped: Dict[str, str],
) -> Dict[str, str]:
    """
    Divide el transcript por anchors de sección y asigna el texto
    entre anchors consecutivos al data-testid correspondiente.

    Ejemplo:
        "motivo de consulta visión borrosa enfermedad actual astigmatismo"
        → {"attention-origin-reason-for-consulting-badge-field": "Visión borrosa",
           "attention-origin-current-disease-badge-field": "Astigmatismo"}
    """
    if not transcript.strip():
        return {}

    # Encontrar todas las posiciones de anchors en el transcript
    anchor_positions: List[Tuple[int, int, str]] = []  # (start, end, testid)

    for pattern, testid in SECTION_ANCHORS:
        for match in pattern.finditer(transcript):
            anchor_positions.append((match.start(), match.end(), testid))

    # Usar solo keywords de acción (guardar, etc.) como delimitadores de corte
    # para evitar que palabras genéricas (hallazgos, lesiones) corten el texto de secciones
    _DELIMITER_KEYWORDS = {
        kw: tid for kw, tid in _BUTTON_KEYWORDS.items()
        if "save" in tid or "guardar" in kw
    }
    text_lower = transcript.lower()
    for kw in sorted(_DELIMITER_KEYWORDS.keys(), key=len, reverse=True):
        idx = text_lower.find(kw)
        if idx >= 0:
            overlaps = any(s <= idx < e for s, e, _ in anchor_positions)
            if not overlaps:
                anchor_positions.append((idx, idx + len(kw), "__button_delimiter__"))

    if not anchor_positions:
        return {}

    # Ordenar por posición en el transcript
    anchor_positions.sort(key=lambda x: x[0])

    # Deduplicar: si hay múltiples anchors para el mismo testid, tomar el primero.
    # Si hay anchors solapados, priorizar el más largo (más específico).
    deduped: List[Tuple[int, int, str]] = []
    seen_testids = set()
    for start, end, testid in anchor_positions:
        # Verificar solapamiento con el anchor anterior
        if deduped:
            prev_start, prev_end, prev_testid = deduped[-1]
            if start < prev_end:
                # Solapamiento: mantener el más largo
                if (end - start) > (prev_end - prev_start):
                    if prev_testid in seen_testids:
                        seen_testids.discard(prev_testid)
                    deduped[-1] = (start, end, testid)
                    seen_testids.add(testid)
                continue

        if testid == "__button_delimiter__" or testid not in seen_testids:
            deduped.append((start, end, testid))
            if testid != "__button_delimiter__":
                seen_testids.add(testid)

    results: Dict[str, str] = {}

    for i, (start, end, testid) in enumerate(deduped):
        # Delimitadores de button solo sirven como puntos de corte, no generan contenido
        if testid == "__button_delimiter__":
            continue

        # El contenido va desde el fin del anchor hasta el inicio del siguiente anchor
        if i + 1 < len(deduped):
            next_start = deduped[i + 1][0]
            content = transcript[end:next_start].strip()
        else:
            # Último anchor: contenido hasta el final del transcript
            content = transcript[end:].strip()

        if not content:
            continue

        # No mapear si el campo no existe, ya está lleno o ya fue mapeado
        if not _field_exists(testid, field_index):
            continue
        if _is_already_filled(testid, already_filled):
            continue
        if testid in already_mapped:
            continue

        # Limpiar conectores iniciales del contenido
        content = clean_captured_value(content)
        if content:
            results[testid] = content
            logger.debug(
                f"[BatchMapper] Sección: '{testid}' = '{content[:80]}'"
            )

    return results
