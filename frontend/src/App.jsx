import React, { useEffect, useMemo, useState } from "react";

const API_BASE = "http://127.0.0.1:8000";

const HEATING_OPTIONS = [
  "Zentralheizung",
  "Fernwaerme",
  "Gas-Heizung",
  "Etagenheizung",
  "Fussbodenheizung",
  "Oelheizung",
  "Waermepumpe",
  "Holzpelletheizung",
  "Andere",
];

const CONDITION_OPTIONS = [
  "Gepflegt",
  "Erstbezug",
  "Saniert",
  "Vollstaendig renoviert",
  "Neuwertig",
  "Modernisiert",
  "Erstbezug nach Sanierung",
  "Andere",
];

const QUALITY_OPTIONS = ["Normal", "Gehoben", "Luxus", "Einfach"];

const TYPE_OPTIONS = [
  "Etagenwohnung",
  "Dachgeschoss",
  "Erdgeschoss",
  "Maisonette",
  "Hochparterre",
  "Penthouse",
  "Souterrain",
  "Andere",
];

function toLabel(value) {
  return String(value).replace(/_/g, " ");
}

export default function App() {
  const [geoData, setGeoData] = useState({});
  const [loadingGeo, setLoadingGeo] = useState(true);
  const [geoError, setGeoError] = useState("");

  const [stateKey, setStateKey] = useState("");
  const [cityKey, setCityKey] = useState("");
  const [plz, setPlz] = useState("");

  const [livingSpace, setLivingSpace] = useState(75);
  const [rooms, setRooms] = useState(3);
  const [floor, setFloor] = useState(1);
  const [yearConstructed, setYearConstructed] = useState(1995);

  const [heatingType, setHeatingType] = useState(HEATING_OPTIONS[0]);
  const [condition, setCondition] = useState(CONDITION_OPTIONS[0]);
  const [interiorQual, setInteriorQual] = useState(QUALITY_OPTIONS[0]);
  const [typeOfFlat, setTypeOfFlat] = useState(TYPE_OPTIONS[0]);

  const [balcony, setBalcony] = useState(false);
  const [lift, setLift] = useState(false);
  const [hasKitchen, setHasKitchen] = useState(false);
  const [garden, setGarden] = useState(false);
  const [cellar, setCellar] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [prediction, setPrediction] = useState(null);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/geo`)
      .then((res) => {
        if (!res.ok) throw new Error("Geo data fetch failed");
        return res.json();
      })
      .then((data) => {
        setGeoData(data || {});
        const states = Object.keys(data || {}).sort();
        if (states.length > 0) {
          const initialState = states[0];
          setStateKey(initialState);
          const cities = Object.keys(data[initialState] || {}).sort();
          if (cities.length > 0) {
            const initialCity = cities[0];
            setCityKey(initialCity);
            const plzs = (data[initialState][initialCity] || []).slice().sort();
            if (plzs.length > 0) setPlz(plzs[0]);
          }
        }
      })
      .catch((err) => {
        setGeoError(err.message || "Geo data konnte nicht geladen werden");
      })
      .finally(() => setLoadingGeo(false));
  }, []);

  const states = useMemo(() => Object.keys(geoData).sort(), [geoData]);
  const cities = useMemo(() => {
    if (!stateKey || !geoData[stateKey]) return [];
    return Object.keys(geoData[stateKey]).sort();
  }, [geoData, stateKey]);

  const plzList = useMemo(() => {
    if (!stateKey || !cityKey || !geoData[stateKey] || !geoData[stateKey][cityKey]) return [];
    return geoData[stateKey][cityKey].slice().sort();
  }, [geoData, stateKey, cityKey]);

  useEffect(() => {
    if (stateKey && cities.length > 0 && !cities.includes(cityKey)) {
      setCityKey(cities[0]);
    }
  }, [stateKey, cities, cityKey]);

  useEffect(() => {
    if (stateKey && cityKey && plzList.length > 0 && !plzList.includes(plz)) {
      setPlz(plzList[0]);
    }
  }, [stateKey, cityKey, plzList, plz]);

  function handleStateChange(e) {
    const nextState = e.target.value;
    setStateKey(nextState);
    const nextCities = Object.keys(geoData[nextState] || {}).sort();
    const nextCity = nextCities[0] || "";
    setCityKey(nextCity);
    const nextPlz = nextCity ? (geoData[nextState][nextCity] || [])[0] : "";
    setPlz(nextPlz || "");
  }

  function handleCityChange(e) {
    const nextCity = e.target.value;
    setCityKey(nextCity);
    const nextPlz = (geoData[stateKey]?.[nextCity] || [])[0];
    setPlz(nextPlz || "");
  }

  function handlePlzChange(e) {
    const value = e.target.value.trim();
    setPlz(value);
    if (value.length !== 5) return;
    for (const [state, citiesMap] of Object.entries(geoData)) {
      for (const [city, plzs] of Object.entries(citiesMap)) {
        if (plzs.includes(value)) {
          setStateKey(state);
          setCityKey(city);
          return;
        }
      }
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    setSubmitError("");
    setPrediction(null);
    setIsSubmitting(true);

    const payload = {
      livingSpace: Number(livingSpace),
      noRooms: Number(rooms),
      floor: Number(floor),
      yearConstructed: Number(yearConstructed),
      regio1: stateKey,
      regio2: cityKey,
      geo_plz: String(plz),
      heatingType,
      condition,
      interiorQual,
      typeOfFlat,
      balcony,
      lift,
      hasKitchen,
      garden,
      cellar,
    };

    fetch(`${API_BASE}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data?.detail || "Vorhersage fehlgeschlagen");
        setPrediction(data.prediction);
      })
      .catch((err) => setSubmitError(err.message || "API Fehler"))
      .finally(() => setIsSubmitting(false));
  }

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Immobilienbewertung</p>
          <h1>Mietpreis-Expertensystem</h1>
          <p className="subhead">
            Zuverlaessige Schaetzung auf Basis von Standort, Objektmerkmalen und Marktstruktur.
          </p>
          <div className="hero-tags">
            <span className="tag">Standort-Logik</span>
            <span className="tag">Marktmodell</span>
            <span className="tag">Transparente Eingaben</span>
          </div>
        </div>
        <div className="hero-card">
          <p className="hero-label">Systemstatus</p>
          <div className="hero-status">
            <span className={`pill ${loadingGeo ? "pill-warn" : "pill-ok"}`}>
              {loadingGeo ? "Lade Daten" : "Bereit"}
            </span>
            <span className="pill">Datenquelle: geo_data.json</span>
          </div>
          <div className="hero-metrics">
            <div>
              <p className="metric-label">Antwortzeit</p>
              <p className="metric-value">~1s lokal</p>
            </div>
            <div>
              <p className="metric-label">Modell</p>
              <p className="metric-value">LightGBM</p>
            </div>
          </div>
        </div>
      </header>

      <main className="content">
        <form className="form" onSubmit={handleSubmit}>
          <section className="section">
            <div className="section-header">
              <h2>1. Standort</h2>
              <p>Bundesland, Stadt und PLZ bleiben synchron.</p>
            </div>

            {geoError && <div className="alert error">{geoError}</div>}

            <div className="grid-3">
              <label className="field">
                <span>Bundesland</span>
                <select value={stateKey} onChange={handleStateChange} disabled={loadingGeo}>
                  {states.map((state) => (
                    <option key={state} value={state}>
                      {toLabel(state)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Stadt / Landkreis</span>
                <select value={cityKey} onChange={handleCityChange} disabled={loadingGeo}>
                  {cities.map((city) => (
                    <option key={city} value={city}>
                      {toLabel(city)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>PLZ</span>
                <input
                  list="plzList"
                  value={plz}
                  onChange={handlePlzChange}
                  placeholder="z.B. 80331"
                  disabled={loadingGeo}
                />
                <datalist id="plzList">
                  {plzList.map((code) => (
                    <option key={code} value={code} />
                  ))}
                </datalist>
              </label>
            </div>
          </section>

          <section className="section">
            <div className="section-header">
              <h2>2. Gebaeudedaten</h2>
              <p>Setze realistische Werte fuer eine bessere Prognose.</p>
            </div>

            <div className="grid-4">
              <label className="field">
                <span>Wohnflaeche (m2)</span>
                <input
                  type="number"
                  min="10"
                  max="600"
                  value={livingSpace}
                  onChange={(e) => setLivingSpace(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Zimmer</span>
                <input
                  type="number"
                  min="1"
                  max="15"
                  value={rooms}
                  onChange={(e) => setRooms(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Etage</span>
                <input
                  type="number"
                  min="-1"
                  max="40"
                  value={floor}
                  onChange={(e) => setFloor(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Baujahr</span>
                <input
                  type="number"
                  min="1900"
                  max="2025"
                  value={yearConstructed}
                  onChange={(e) => setYearConstructed(e.target.value)}
                />
              </label>
            </div>
          </section>

          <section className="section">
            <div className="section-header">
              <h2>3. Qualitaet & Zustand</h2>
              <p>Material und Zustand sind entscheidend fuer die Bewertung.</p>
            </div>

            <div className="grid-4">
              <label className="field">
                <span>Heizung</span>
                <select value={heatingType} onChange={(e) => setHeatingType(e.target.value)}>
                  {HEATING_OPTIONS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Zustand</span>
                <select value={condition} onChange={(e) => setCondition(e.target.value)}>
                  {CONDITION_OPTIONS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Qualitaet</span>
                <select value={interiorQual} onChange={(e) => setInteriorQual(e.target.value)}>
                  {QUALITY_OPTIONS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Wohnungstyp</span>
                <select value={typeOfFlat} onChange={(e) => setTypeOfFlat(e.target.value)}>
                  {TYPE_OPTIONS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="section">
            <div className="section-header">
              <h2>4. Extras</h2>
              <p>Kleine Features koennen den Mietpreis spuerbar veraendern.</p>
            </div>

            <div className="toggle-grid">
              <label className="toggle">
                <input type="checkbox" checked={balcony} onChange={(e) => setBalcony(e.target.checked)} />
                <span>Balkon</span>
              </label>
              <label className="toggle">
                <input type="checkbox" checked={lift} onChange={(e) => setLift(e.target.checked)} />
                <span>Aufzug</span>
              </label>
              <label className="toggle">
                <input type="checkbox" checked={hasKitchen} onChange={(e) => setHasKitchen(e.target.checked)} />
                <span>Einbaukueche</span>
              </label>
              <label className="toggle">
                <input type="checkbox" checked={garden} onChange={(e) => setGarden(e.target.checked)} />
                <span>Garten</span>
              </label>
              <label className="toggle">
                <input type="checkbox" checked={cellar} onChange={(e) => setCellar(e.target.checked)} />
                <span>Keller</span>
              </label>
            </div>
          </section>

          <div className="actions">
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Berechne..." : "Mietpreis berechnen"}
            </button>
            {submitError && <div className="alert error">{submitError}</div>}
          </div>

          {prediction !== null && (
            <section className="result">
              <div>
                <p className="result-label">Geschaetzte Gesamtmiete</p>
                <h3>{prediction.toFixed(2)} EUR</h3>
                <p className="result-meta">
                  {toLabel(cityKey)}, {toLabel(stateKey)} - {livingSpace} m2
                </p>
              </div>
            </section>
          )}
        </form>
      </main>
    </div>
  );
}
