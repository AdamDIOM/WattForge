# Methodology Report

## 1. Modeling Techniques

### 48-Hour Forecast (Short-Term)
The short-term (next 48 hours) forecast uses a hybrid synthetic + AI-assisted approach:
- **Synthetic Base Layer**: Deterministic diurnal curve (sinusoidal profile) modulated by:
  - Hour-of-day load shape learned from historical averages.
  - EV penetration factor increasing evening (typically 18:00–22:00 UTC) values.
  - Mild temperature heuristic (if weather data available) to adjust heating-sensitive hours.
- **LLM Normalization (Hyper Train)**: A Gemini model is prompted with compact historical samples and asked to produce per-group hourly forecasts. The backend normalizes and clamps values (0–5 FWh typical range) and fills gaps.
- **Aggregation**: Per-group hourly series are averaged to produce a single aggregated 48h view for UI convenience.

Rationale:
- Short-term energy consumption exhibits strong daily cyclicality; a shaped deterministic baseline is stable and explainable.
- Incorporating a Large Language Model (LLM) adds flexible pattern inference (group-level nuance) without building a full bespoke time-series ML stack under hackathon time constraints.
- Guardrails ensure LLM output remains structurally consistent and within plausible bounds.

### 12-Month Forecast (Medium-Term)
The monthly forecast synthesizes 12 future periods using:
- **Baseline Scaling**: Typical hourly baseline * hours in month.
- **Seasonality Approximation**: Cosine factor (±10%) to simulate mild seasonal variation (e.g., winter heating uplift, summer reduction).
- **LLM Contribution**: When available, Gemini provides per-group monthly values; missing or incomplete outputs are synthesized using the above rules.

Rationale:
- Monthly aggregation smooths high-frequency volatility. A simple parametric seasonal model is transparent and adequate given limited granularity.
- The LLM can imprint subtle group differences while fallback ensures deterministic completion.

## 2. Feature Selection & External Data

### Data Preprocessing
- **Workbook Parsing**: Three sheets: `training_consumption`, `training_prices`, `groups`.
- **Normalization**:
  - Units standardized to FortumWattHours (FWh).
  - Headers cleaned (removed unit suffix), semicolon-separated CSV, decimal comma formatting.
- **Aggregate Metrics**: Average, min, max, peak hour, per-hour historical averages.
- **Group Extraction**: All non-timestamp columns treated as group IDs.

### Features Used
- Timestamp (converted to hour-of-day and month index).
- Historical per-group loads (implicitly via average and sample rows in prompt).
- Price hints (first rows included in prompt, potential economic driver though not deeply modeled).
- EV penetration percentage (user-provided) influences evening adjustment.
- Derived diurnal pattern (sinusoidal amplitude shaping).
- Seasonal index (cosine month-of-year function).

### External Data
- **Weather (Open-Meteo API)**: Optional short temperature sample integrated into the analysis prompt—currently a qualitative driver rather than a quantitative regression factor.

Impact:
- Historical aggregates anchor baseline realism.
- EV and temperature drivers introduce scenario sensitivity without overfitting.
- External weather data increases narrative credibility and allows future quantitative enhancement.

## 3. Model Training & Validation

### Training Approach
- No heavy statistical model training (e.g., ARIMA, Prophet, LSTM) due to time constraints and requirement for explainability.
- LLM prompt engineering acts as a lightweight transfer mechanism: model observes structured summaries + samples and outputs structured forecasts.

### Guardrails & Normalization
- Strict JSON schema requested (48 hourly, 12 monthly entries per group).
- Tolerant parsing accepts variant key names and shapes; timestamps canonicalized.
- Missing or malformed values synthesized using deterministic baseline.
- Values clamped to plausible ranges to prevent hallucinated extremes.

### Validation Strategy
- **Structural Validation**: Ensure arrays lengths (48/12) per group; if deficient, padded or regenerated.
- **Range Checks**: Clamp values; record min/max for summary.
- **Fallback Logic**: Aggregated synthetic baseline used if LLM output unusable.
- **Robustness**: Relaxed rejection policy—rarely blocks; instead salvages and annotates.

### Rationale for Approach
- Emphasizes resilience and explainability over maximizing raw predictive accuracy.
- Avoids cold-start complexity: deterministic fallback always available.

## 4. Business Understanding (Fortum Context)
- **Operational Relevance**: Fortum benefits from near-term (48h) load visibility for asset dispatch, demand response, and pricing strategy.
- **Group-Level Detail**: Per-group forecasts allow segment analysis (e.g., residential vs commercial clusters) informing targeted interventions.
- **Scalability**: Simple deterministic core plus LLM layer can be extended with richer features (weather normalization, tariff elasticity) without architectural overhaul.
- **Explainability**: Deterministic components (diurnal, EV factor, seasonality) can be clearly communicated to stakeholders; LLM output is constrained and normalized.
- **Risk Mitigation**: Guardrails prevent malformed or unrealistic AI outputs from entering operational pipelines.

## 5. Results Summary

### Performance vs Baseline
- **Baseline**: Pure deterministic diurnal + seasonality.
- **Enhanced (LLM)**: Adds micro-structure per group; more varied peaks, slight differentiation in nightly troughs.
- **Stability**: When LLM deviates or omits groups, normalization restores completeness.

### Qualitative Gains
- Improved narrative drivers (analysis endpoint) aiding operational decision-making.
- Faster iteration: no retraining cycles; prompt adjustments reflect instantly.

### Quantitative Indicators (Illustrative)
- Hourly range typically confined to 0–5 FWh per group (after clamping).
- Monthly totals scale with month hours; seasonal modulation ±10%.
- Peak hour alignment with historical peak (guardrail encourages consistency).

*Note:* Due to hackathon scope and absence of a formal hold-out set, exact error metrics (MAE/RMSE) are not computed; methodology favors completeness, guardrails, and transparency.

## 6. Future Extensions
- Integrate true weather time-series into hourly regression layer.
- Add automatic evaluation metrics (e.g., compare synthetic vs actual for last known horizon).
- Introduce price elasticity modeling (load response to price signals).
- Persist training data & model outputs for reproducible audits.
- Optional replacement of synthetic baseline with classical statistical or ML models (Prophet / LightGBM) for accuracy benchmarking.

## 7. Summary
This solution combines a deterministic, explainable forecasting scaffold with LLM-assisted enrichment under tight time constraints. Guardrails, normalization, and fallback synthesis ensure reliable structured outputs for both 48-hour and 12-month horizons, while maintaining adaptability for future enhancements aligned with Fortum’s operational needs.
