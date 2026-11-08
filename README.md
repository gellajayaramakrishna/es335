# Predicting Urban Land Surface Temperature in Ahmedabad

**ES 335 Machine Learning · IIT Gandhinagar · 2026**

Gella Jaya Rama Krishna (23110115) · Jangam Sanjay (23110144)

**Live website:** https://gellajayaramakrishna.github.io/es335/

---

## Question

How accurately can machine learning models predict summer land surface temperature (LST) across Ahmedabad from satellite-derived vegetation, built-up, moisture and land-cover features? How well do they generalise to geographically separate areas, and which features are most informative for identifying heat hotspots?

- **One row:** one 300 m × 300 m grid cell in one summer (April–June median composite)
- **Target:** land surface temperature in °C
- **Data size:** 9,461 grid cells × 6 years (2020–2025) = 56,582 rows after cleaning

## Main results (held-out spatial test blocks)

| Model | MAE (°C) | RMSE (°C) | R² |
|---|---|---|---|
| Baseline (training mean) | 2.410 | 3.153 | −0.026 |
| Linear Regression | 1.462 | 1.916 | 0.621 |
| Random Forest (tuned) | 1.382 | 1.810 | 0.662 |

- Random Forest beats Linear Regression by 0.081 °C MAE (95% block-bootstrap interval 0.044 to 0.118 °C): consistent, but small.
- NDBI is by far the most informative feature. Static land-cover fractions add little.
- Random Forest recovers about 54% of the true hottest 10% of test cells, versus about 10% for random guessing.
- The model underestimates the hottest cells (above 54 °C) by about 4 °C on average.

## Repository structure

```
es335/
├── data/
│   ├── raw/                         # CSVs exported from Google Earth Engine (one per year)
│   └── processed/                   # cleaned data, split labels, test predictions, test_blocks.json
├── notebooks/
│   ├── 01_gee_export.ipynb          # Earth Engine: cloud masking, features, 300 m grid, export
│   ├── 02_explore_data.ipynb        # merge, quality checks, plots, cleaning
│   ├── 03_spatial_split.ipynb       # 3 km block split, 20% of blocks held out
│   ├── 04_models.ipynb              # baseline, Linear Regression, Random Forest, CV, final test
│   ├── 05_interpret_errors.ipynb    # importance, coefficients, residuals, hotspot recall
│   └── 06_export_web_data.ipynb     # JSON files for the website
├── outputs/
│   ├── figures/                     # all plots
│   └── *.csv                        # CV results, test results, importance, error tables
├── docs/                            # website (served by GitHub Pages)
│   ├── index.html
│   ├── css/style.css
│   ├── js/app.js
│   ├── data/                        # cells.json, metrics.json, scatter.json
│   └── figures/
├── requirements.txt
└── README.md
```

## Data access

| Dataset | Earth Engine ID | Use |
|---|---|---|
| Landsat 8 Collection 2 Level 2 | `LANDSAT/LC08/C02/T1_L2` | surface reflectance and surface temperature |
| Landsat 9 Collection 2 Level 2 | `LANDSAT/LC09/C02/T1_L2` | surface reflectance and surface temperature |
| ESA WorldCover v200 (2021) | `ESA/WorldCover/v200` | land-cover fractions |

- **Study area:** longitude 72.45–72.75°E, latitude 22.90–23.15°N
- **Period:** April–June, 2020–2025
- **Grid:** 300 m, projection EPSG:32643 (UTM zone 43N)

The data is free, but downloading it requires a Google Earth Engine account with a registered Cloud project (the free noncommercial "Community" tier is enough). **The exported CSVs are already included in `data/raw/`, so you can skip the export step entirely.**

No credentials are stored in this repository. The Earth Engine login token is saved locally by the `earthengine-api` package, outside the project folder.

## How to reproduce

### 1. Set up

```bash
git clone https://github.com/gellajayaramakrishna/es335.git
cd es335
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Tested with Python 3.14 on macOS.

### 2. (Optional) Re-export the raw data from Earth Engine

1. Create a Google Cloud project and register it for noncommercial Earth Engine use at https://code.earthengine.google.com/register
2. Open `notebooks/01_gee_export.ipynb`, set your project ID in `ee.Initialize(project='...')`, and run all cells.
3. Download the six CSVs from the `ES335_LST` folder in your Google Drive into `data/raw/`.

### 3. Run the analysis

Run the notebooks in order: `02` → `03` → `04` → `05` → `06`. Each notebook reads the previous one's output from `data/processed/` or `outputs/`.

### 4. Key settings

| Setting | Value |
|---|---|
| Cloud mask | Landsat QA_PIXEL bits 1, 3, 4 (dilated cloud, cloud, shadow) |
| Quality filter | drop cells with fewer than 3 clear observations |
| Spatial blocks | 3 km × 3 km, 110 blocks |
| Test set | 22 blocks (20%), random seed 42, listed in `data/processed/test_blocks.json` |
| Cross-validation | 5-fold GroupKFold on training blocks, grouped by block |
| Random Forest | 300 trees, max_depth 20, max_features 0.5, min_samples_leaf 5 |
| Features | NDVI, NDBI, NDWI, frac_tree, frac_shrub, frac_grass, frac_crop, frac_built, frac_bare, frac_water (Linear Regression drops frac_crop) |

### 5. View the website locally

```bash
cd docs
python -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` directly will not load the data, because browsers block local JSON files.

## Limitations

- LST is ground-surface temperature at the morning satellite overpass (about 10:30 IST), not air temperature.
- Land-cover fractions come from a single 2021 map.
- NDBI does not fully separate buildings from dry bare soil.
- Only 22 test blocks, so the scores carry real uncertainty.
- Results are associations, not causal effects.

## Citations

- Landsat 8–9 Collection 2 Level 2 data courtesy of the U.S. Geological Survey.
- Zanaga, D. et al. (2022). *ESA WorldCover 10 m 2021 v200*. https://doi.org/10.5281/zenodo.7254221
- Gorelick, N. et al. (2017). Google Earth Engine: Planetary-scale geospatial analysis for everyone. *Remote Sensing of Environment*, 202, 18–27.
- Pedregosa, F. et al. (2011). Scikit-learn: Machine Learning in Python. *JMLR*, 12, 2825–2830.
- Leaflet (https://leafletjs.com), Chart.js (https://www.chartjs.org), OpenStreetMap contributors (base map).

## AI-use disclosure

Claude (Anthropic) was used to help draft code for the notebooks and website, and to explain methods. All design choices, analysis runs, results and interpretations were checked by us, and we take responsibility for the work.

## Contributions

- **Gella Jaya Rama Krishna:** _fill in_
- **Jangam Sanjay:** _fill in_