"use client";

import { ChangeEvent, CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { categoryEmoji, categoryForFood, lookupNutrition } from "@/lib/nutrition-db";
import { compressImageToBase64, fileToDataUrl } from "@/lib/image";
import { addMeal, deleteMeal, isToday, isYesterday, loadMeals } from "@/lib/storage";
import { DetectedFood, GeminiFoodItem, GeminiFoodResponse, MealLog, NutritionInfo } from "@/lib/types";

const GOALS = {
  calories: 2000,
  protein: 150,
  carbs: 250,
  fat: 65
};

type Tab = "home" | "history";
type ScanPhase = "picker" | "analyzing" | "result";

export default function AppClient() {
  const [tab, setTab] = useState<Tab>("home");
  const [meals, setMeals] = useState<MealLog[]>([]);

  const [scanOpen, setScanOpen] = useState(false);
  const [scanPhase, setScanPhase] = useState<ScanPhase>("picker");
  const [selectedImageDataUrl, setSelectedImageDataUrl] = useState<string>("");
  const [detectedFoods, setDetectedFoods] = useState<DetectedFood[]>([]);
  const [mealName, setMealName] = useState("Meal");
  const [scanError, setScanError] = useState<string>("");
  const [scanWarning, setScanWarning] = useState<string>("");

  const [detailMeal, setDetailMeal] = useState<MealLog | null>(null);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMeals(loadMeals());
  }, []);

  const todayMeals = useMemo(() => meals.filter((meal) => isToday(meal.date)), [meals]);
  const todayNutrition = useMemo(() => sumMealsNutrition(todayMeals), [todayMeals]);

  const historyGroups = useMemo(() => groupByDay(meals), [meals]);

  function openScan() {
    setScanOpen(true);
    setScanPhase("picker");
    setSelectedImageDataUrl("");
    setDetectedFoods([]);
    setMealName("Meal");
    setScanError("");
    setScanWarning("");
  }

  function closeScan() {
    setScanOpen(false);
    setScanPhase("picker");
    setScanError("");
    setScanWarning("");
  }

  async function onImagePicked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";

    setScanError("");
    setScanWarning("");
    setScanPhase("analyzing");

    try {
      const previewDataUrl = await fileToDataUrl(file);
      setSelectedImageDataUrl(previewDataUrl);

      const base64 = await compressImageToBase64(file, 1280, 1_500_000);
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: base64,
          mimeType: file.type || "image/jpeg"
        })
      });

      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errorPayload?.error || "Failed to analyze image.");
      }

      const payload = (await response.json()) as GeminiFoodResponse & { warning?: string };
      const foods = (payload.foods || []).map(mapGeminiFoodToDetectedFood).filter(Boolean) as DetectedFood[];

      if (foods.length === 0) {
        throw new Error("No foods detected. Try a clearer photo.");
      }

      setDetectedFoods(foods);
      if (payload.warning) setScanWarning(payload.warning);
      setMealName("Meal");
      setScanPhase("result");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error analyzing image.";
      setScanError(message);
      setScanPhase("picker");
    }
  }

  function updateFoodGrams(id: string, grams: number) {
    if (!Number.isFinite(grams) || grams <= 0) return;
    setDetectedFoods((prev) =>
      prev.map((food) => {
        if (food.id !== id) return food;
        const factor = grams / Math.max(food.estimatedGrams, 1);
        return {
          ...food,
          estimatedGrams: grams,
          nutrition: {
            calories: food.nutrition.calories * factor,
            protein: food.nutrition.protein * factor,
            carbs: food.nutrition.carbs * factor,
            fat: food.nutrition.fat * factor,
            fiber: food.nutrition.fiber * factor
          }
        };
      })
    );
  }

  function removeFood(id: string) {
    setDetectedFoods((prev) => prev.filter((food) => food.id !== id));
  }

  function saveCurrentMeal() {
    if (detectedFoods.length === 0) return;

    const totals = sumNutrition(detectedFoods.map((food) => food.nutrition));
    const meal: MealLog = {
      id: generateId(),
      date: new Date().toISOString(),
      imageDataUrl: selectedImageDataUrl || undefined,
      foods: detectedFoods,
      totalCalories: totals.calories,
      totalProtein: totals.protein,
      totalCarbs: totals.carbs,
      totalFat: totals.fat,
      totalFiber: totals.fiber,
      mealName: mealName.trim() || "Meal"
    };

    const updated = addMeal(meal);
    setMeals(updated);
    setTab("home");
    closeScan();
  }

  function removeMealFromHistory(id: string) {
    const updated = deleteMeal(id);
    setMeals(updated);
    if (detailMeal?.id === id) setDetailMeal(null);
  }

  const progress = Math.min(todayNutrition.calories / Math.max(GOALS.calories, 1), 1);
  const progressStyle = {
    "--progress": Math.round(progress * 100)
  } as CSSProperties;

  return (
    <>
      <main className="app-shell">
        {tab === "home" ? (
          <HomeScreen
            todayMeals={todayMeals}
            todayNutrition={todayNutrition}
            progressStyle={progressStyle}
          />
        ) : (
          <HistoryScreen
            groups={historyGroups}
            onOpenDetail={setDetailMeal}
            onDelete={removeMealFromHistory}
          />
        )}
      </main>

      <nav className="tabbar">
        <div className="tabbar-inner">
          <button
            className={`tab-btn ${tab === "home" ? "active" : ""}`}
            type="button"
            onClick={() => setTab("home")}
          >
            <span>🏠</span>
            <span className="tiny">Home</span>
          </button>

          <button className="scan-main-btn" type="button" onClick={openScan} aria-label="Scan food">
            📷
          </button>

          <button
            className={`tab-btn ${tab === "history" ? "active" : ""}`}
            type="button"
            onClick={() => setTab("history")}
          >
            <span>📊</span>
            <span className="tiny">History</span>
          </button>
        </div>
      </nav>

      {scanOpen && (
        <ScanModal
          phase={scanPhase}
          imageDataUrl={selectedImageDataUrl}
          foods={detectedFoods}
          mealName={mealName}
          warning={scanWarning}
          error={scanError}
          cameraInputRef={cameraInputRef}
          galleryInputRef={galleryInputRef}
          onClose={closeScan}
          onImagePicked={onImagePicked}
          onMealNameChange={setMealName}
          onUpdateGrams={updateFoodGrams}
          onDeleteFood={removeFood}
          onSave={saveCurrentMeal}
          onRetake={() => {
            setScanPhase("picker");
            setDetectedFoods([]);
            setScanWarning("");
            setScanError("");
          }}
        />
      )}

      {detailMeal && (
        <MealDetailModal meal={detailMeal} onClose={() => setDetailMeal(null)} />
      )}
    </>
  );
}

function HomeScreen({
  todayMeals,
  todayNutrition,
  progressStyle
}: {
  todayMeals: MealLog[];
  todayNutrition: NutritionInfo;
  progressStyle: CSSProperties;
}) {
  const greeting = getGreeting();
  const remaining = Math.max(0, GOALS.calories - todayNutrition.calories);

  return (
    <>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
        <div>
          <p className="muted" style={{ margin: 0, fontSize: "1.95rem", fontWeight: 800 }}>
            {greeting}
          </p>
          <h1 className="screen-title">Today&apos;s Nutrition</h1>
        </div>
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: 999,
            background: "rgba(166,239,89,0.16)",
            display: "grid",
            placeItems: "center"
          }}
        >
          🌿
        </div>
      </header>

      <section className="card">
        <div className="macro-ring-wrap">
          <div className="ring" style={progressStyle}>
            <div className="ring-center">
              <div>
                <div style={{ fontSize: "2.7rem", fontWeight: 800, lineHeight: 1 }}>{Math.round(todayNutrition.calories)}</div>
                <div className="muted">kcal</div>
                <div style={{ color: "var(--neon)", fontSize: "0.8rem", fontWeight: 700 }}>{Math.round(remaining)} left</div>
              </div>
            </div>
          </div>
        </div>

        <div className="macro-pills">
          <MacroPill label="Protein" value={todayNutrition.protein} color="var(--protein)" />
          <MacroPill label="Carbs" value={todayNutrition.carbs} color="var(--carbs)" />
          <MacroPill label="Fat" value={todayNutrition.fat} color="var(--fat)" />
        </div>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <div className="section-head">
          <h2 style={{ margin: 0 }}>Macro Breakdown</h2>
          <span className="muted">{todayMeals.length} meals</span>
        </div>
        <MacroRow label="Protein" value={todayNutrition.protein} goal={GOALS.protein} color="var(--protein)" />
        <MacroRow label="Carbohydrates" value={todayNutrition.carbs} goal={GOALS.carbs} color="var(--carbs)" />
        <MacroRow label="Fat" value={todayNutrition.fat} goal={GOALS.fat} color="var(--fat)" />
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <div className="section-head">
          <h2 style={{ margin: 0 }}>Today&apos;s Meals</h2>
          <span className="muted">{todayMeals.length}</span>
        </div>
        {todayMeals.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No meals logged today.
          </p>
        ) : (
          todayMeals.map((meal) => (
            <div key={meal.id} className="meal-row">
              {meal.imageDataUrl ? <img className="thumb" src={meal.imageDataUrl} alt={meal.mealName} /> : <div className="thumb" />}
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontWeight: 700 }}>{meal.mealName}</p>
                <p className="muted tiny" style={{ margin: "0.1rem 0 0" }}>
                  {formatTime(meal.date)}
                </p>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="kcal">{Math.round(meal.totalCalories)}</div>
                <div className="muted tiny">kcal</div>
              </div>
            </div>
          ))
        )}
      </section>
    </>
  );
}

function HistoryScreen({
  groups,
  onOpenDetail,
  onDelete
}: {
  groups: Array<{ key: string; title: string; meals: MealLog[] }>;
  onOpenDetail: (meal: MealLog) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <>
      <header style={{ marginBottom: "1rem" }}>
        <h1 className="screen-title">History</h1>
      </header>

      {groups.length === 0 ? (
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>
            No history yet. Save your first scan.
          </p>
        </section>
      ) : (
        groups.map((group) => (
          <div key={group.key} className="history-day">
            <div className="section-head" style={{ paddingInline: "0.2rem" }}>
              <strong>{group.title}</strong>
              <span className="muted">{Math.round(sumMealsNutrition(group.meals).calories)} kcal</span>
            </div>
            <section className="card">
              {group.meals.map((meal) => (
                <div key={meal.id} className="meal-row" style={{ alignItems: "flex-start" }}>
                  {meal.imageDataUrl ? <img className="thumb" src={meal.imageDataUrl} alt={meal.mealName} /> : <div className="thumb" />}
                  <button
                    type="button"
                    style={{
                      flex: 1,
                      background: "transparent",
                      border: 0,
                      color: "inherit",
                      textAlign: "left",
                      cursor: "pointer",
                      padding: 0
                    }}
                    onClick={() => onOpenDetail(meal)}
                  >
                    <p style={{ margin: 0, fontWeight: 700 }}>{meal.mealName}</p>
                    <p className="muted tiny" style={{ margin: "0.15rem 0 0" }}>
                      {formatTime(meal.date)} - P {Math.round(meal.totalProtein)}g / C {Math.round(meal.totalCarbs)}g / F{" "}
                      {Math.round(meal.totalFat)}g
                    </p>
                  </button>
                  <div style={{ textAlign: "right" }}>
                    <div className="kcal">{Math.round(meal.totalCalories)}</div>
                    <button
                      type="button"
                      onClick={() => onDelete(meal.id)}
                      style={{
                        marginTop: "0.2rem",
                        border: 0,
                        background: "transparent",
                        color: "#ff8a8a",
                        cursor: "pointer"
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </section>
          </div>
        ))
      )}
    </>
  );
}

function ScanModal({
  phase,
  imageDataUrl,
  foods,
  mealName,
  warning,
  error,
  cameraInputRef,
  galleryInputRef,
  onClose,
  onImagePicked,
  onMealNameChange,
  onUpdateGrams,
  onDeleteFood,
  onSave,
  onRetake
}: {
  phase: ScanPhase;
  imageDataUrl: string;
  foods: DetectedFood[];
  mealName: string;
  warning: string;
  error: string;
  cameraInputRef: React.RefObject<HTMLInputElement | null>;
  galleryInputRef: React.RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onImagePicked: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
  onMealNameChange: (name: string) => void;
  onUpdateGrams: (id: string, grams: number) => void;
  onDeleteFood: (id: string) => void;
  onSave: () => void;
  onRetake: () => void;
}) {
  const totals = sumNutrition(foods.map((food) => food.nutrition));

  return (
    <div className="overlay">
      <div className="modal">
        <div className="section-head">
          <strong>{phase === "result" ? "Scan Result" : "Scan Food"}</strong>
          <button type="button" className="btn secondary" onClick={onClose}>
            Close
          </button>
        </div>

        {phase === "picker" && (
          <>
            <section className="card" style={{ marginBottom: "0.8rem" }}>
              <p style={{ marginTop: 0, fontWeight: 700, fontSize: "1.1rem" }}>Snap your meal</p>
              <p className="muted">
                Take a photo or choose from your library. Gemini 1.5 Flash will estimate grams, calories and macros.
              </p>
              <div className="scan-actions">
                <button type="button" className="btn primary" onClick={() => cameraInputRef.current?.click()}>
                  Take Photo
                </button>
                <button type="button" className="btn secondary" onClick={() => galleryInputRef.current?.click()}>
                  Choose from Library
                </button>
              </div>
            </section>

            {error ? (
              <section className="card" style={{ borderColor: "rgba(255,110,110,0.45)" }}>
                <strong style={{ color: "#ff8f8f" }}>Could not detect food</strong>
                <p className="muted" style={{ marginBottom: 0 }}>
                  {error}
                </p>
              </section>
            ) : null}

            <input
              ref={cameraInputRef}
              className="hidden-input"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onImagePicked}
            />
            <input
              ref={galleryInputRef}
              className="hidden-input"
              type="file"
              accept="image/*"
              onChange={onImagePicked}
            />
          </>
        )}

        {phase === "analyzing" && (
          <section className="card analyzing">
            <div className="pulse" />
            <h3 style={{ marginTop: 0 }}>Analyzing your meal...</h3>
            <p className="muted" style={{ marginBottom: 0 }}>
              AI is identifying food items and calculating nutrition.
            </p>
            {imageDataUrl ? (
              <img src={imageDataUrl} alt="Selected meal" className="result-image" style={{ marginTop: "1rem", height: 130 }} />
            ) : null}
          </section>
        )}

        {phase === "result" && (
          <>
            {imageDataUrl ? <img src={imageDataUrl} alt="Scan result" className="result-image" /> : null}

            {warning ? (
              <section className="card" style={{ marginTop: "0.8rem", borderColor: "rgba(255,196,71,0.55)" }}>
                <strong style={{ color: "var(--carbs)" }}>Analysis note</strong>
                <p className="muted" style={{ marginBottom: 0 }}>
                  {warning}
                </p>
              </section>
            ) : null}

            <section className="card" style={{ marginTop: "0.8rem" }}>
              <div className="section-head">
                <strong>Total Nutrition</strong>
                <span className="muted">{foods.length} items</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.4rem", textAlign: "center" }}>
                <div>
                  <div className="kcal">{Math.round(totals.calories)}</div>
                  <div className="tiny muted">Calories</div>
                </div>
                <div>
                  <div>{Math.round(totals.protein)}g</div>
                  <div className="tiny muted">Protein</div>
                </div>
                <div>
                  <div>{Math.round(totals.carbs)}g</div>
                  <div className="tiny muted">Carbs</div>
                </div>
                <div>
                  <div>{Math.round(totals.fat)}g</div>
                  <div className="tiny muted">Fat</div>
                </div>
              </div>
            </section>

            <section className="card" style={{ marginTop: "0.8rem" }}>
              <label htmlFor="meal-name" className="tiny muted">
                Meal Name
              </label>
              <input
                id="meal-name"
                value={mealName}
                onChange={(e) => onMealNameChange(e.target.value)}
                style={{
                  width: "100%",
                  marginTop: "0.3rem",
                  background: "#0f0f14",
                  color: "white",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "0.75rem",
                  padding: "0.65rem 0.8rem"
                }}
              />
            </section>

            <section className="card" style={{ marginTop: "0.8rem" }}>
              <div className="section-head">
                <strong>Detected Foods</strong>
                <span className="muted tiny">Tap grams to edit</span>
              </div>
              {foods.map((food) => (
                <FoodResultRow
                  key={food.id}
                  food={food}
                  onUpdateGrams={(grams) => onUpdateGrams(food.id, grams)}
                  onDelete={() => onDeleteFood(food.id)}
                />
              ))}
            </section>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.7rem", marginTop: "0.8rem" }}>
              <button type="button" className="btn secondary" onClick={onRetake}>
                Retake
              </button>
              <button type="button" className="btn primary" onClick={onSave}>
                Save Meal
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MealDetailModal({ meal, onClose }: { meal: MealLog; onClose: () => void }) {
  return (
    <div className="overlay">
      <div className="modal">
        <div className="section-head">
          <strong>{meal.mealName}</strong>
          <button type="button" className="btn secondary" onClick={onClose}>
            Done
          </button>
        </div>

        {meal.imageDataUrl ? <img className="result-image" src={meal.imageDataUrl} alt={meal.mealName} /> : null}

        <section className="card" style={{ marginTop: "0.8rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", textAlign: "center", gap: "0.4rem" }}>
            <div>
              <div className="kcal">{Math.round(meal.totalCalories)}</div>
              <div className="tiny muted">Calories</div>
            </div>
            <div>
              <div>{Math.round(meal.totalProtein)}g</div>
              <div className="tiny muted">Protein</div>
            </div>
            <div>
              <div>{Math.round(meal.totalCarbs)}g</div>
              <div className="tiny muted">Carbs</div>
            </div>
            <div>
              <div>{Math.round(meal.totalFat)}g</div>
              <div className="tiny muted">Fat</div>
            </div>
          </div>
        </section>

        <section className="card" style={{ marginTop: "0.8rem" }}>
          <div className="section-head">
            <strong>Food Items</strong>
            <span className="muted">{formatTime(meal.date)}</span>
          </div>
          {meal.foods.map((food) => (
            <div className="food-row" key={food.id}>
              <div style={{ width: 30, textAlign: "center" }}>{categoryEmoji(food.category)}</div>
              <div style={{ flex: 1 }}>
                <p className="food-name">{food.name}</p>
                <p className="tiny muted" style={{ margin: 0 }}>
                  {Math.round(food.nutrition.calories)} kcal - P {Math.round(food.nutrition.protein)}g / C {Math.round(food.nutrition.carbs)}g / F{" "}
                  {Math.round(food.nutrition.fat)}g
                </p>
              </div>
              <div className="muted tiny">{Math.round(food.estimatedGrams)}g</div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

function FoodResultRow({
  food,
  onUpdateGrams,
  onDelete
}: {
  food: DetectedFood;
  onUpdateGrams: (grams: number) => void;
  onDelete: () => void;
}) {
  const confidencePct = Math.round(food.confidence * 100);
  const confidenceColor = confidencePct >= 85 ? "var(--neon)" : confidencePct >= 65 ? "var(--carbs)" : "var(--fat)";

  return (
    <div className="food-row">
      <div style={{ width: 34, textAlign: "center" }}>{categoryEmoji(food.category)}</div>
      <div style={{ flex: 1 }}>
        <p className="food-name">{food.name}</p>
        <p className="tiny muted" style={{ margin: 0 }}>
          <span className="kcal">{Math.round(food.nutrition.calories)} kcal</span> - P {Math.round(food.nutrition.protein)}g / C{" "}
          {Math.round(food.nutrition.carbs)}g / F {Math.round(food.nutrition.fat)}g
        </p>
      </div>
      <div style={{ textAlign: "right" }}>
        <input
          type="number"
          min={1}
          defaultValue={Math.round(food.estimatedGrams)}
          onBlur={(e) => {
            const value = Number(e.target.value);
            if (Number.isFinite(value) && value > 0) onUpdateGrams(value);
          }}
          style={{
            width: 70,
            background: "#0f0f14",
            color: "white",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "0.6rem",
            padding: "0.3rem 0.45rem",
            textAlign: "right"
          }}
        />
        <div className="tiny muted">grams</div>
        <span
          className="badge"
          style={{
            color: confidenceColor,
            background: "rgba(255,255,255,0.08)"
          }}
        >
          {confidencePct}%
        </span>
        <div>
          <button
            type="button"
            onClick={onDelete}
            style={{
              border: 0,
              background: "transparent",
              color: "#ff8a8a",
              cursor: "pointer",
              fontSize: "0.75rem",
              marginTop: "0.2rem"
            }}
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

function MacroPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="macro-pill">
      <div style={{ fontSize: "1.5rem", fontWeight: 800 }}>{Math.round(value)}g</div>
      <div className="muted tiny">{label}</div>
      <div className="macro-line" style={{ background: color }} />
    </div>
  );
}

function MacroRow({
  label,
  value,
  goal,
  color
}: {
  label: string;
  value: number;
  goal: number;
  color: string;
}) {
  const progress = Math.min(value / Math.max(goal, 1), 1);
  return (
    <div className="macro-row">
      <div className="macro-row-title">
        <span>{label}</span>
        <span className="muted">
          {Math.round(value)}g / {Math.round(goal)}g
        </span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${progress * 100}%`, background: color }} />
      </div>
    </div>
  );
}

function mapGeminiFoodToDetectedFood(food: GeminiFoodItem): DetectedFood | null {
  const name = String(food.name ?? "").trim();
  if (!name) return null;

  const grams = clamp(food.grams, 0, 2000);
  const calories = clamp(food.calories, 0, 5000);
  const protein = clamp(food.protein, 0, 500);
  const carbs = clamp(food.carbs, 0, 500);
  const fat = clamp(food.fat, 0, 500);
  const confidence = clamp(food.confidence, 0, 100) / 100;
  const category = categoryForFood(name);

  const aiNutrition: NutritionInfo = {
    calories,
    protein,
    carbs,
    fat,
    fiber: 0
  };

  const fallback = lookupNutrition(name, grams || 100);
  const nutrition = calories + protein + carbs + fat > 0 ? aiNutrition : fallback;

  return {
    id: generateId(),
    name,
    estimatedGrams: grams > 0 ? grams : 100,
    confidence,
    category,
    nutrition
  };
}

function sumNutrition(items: NutritionInfo[]): NutritionInfo {
  return items.reduce(
    (acc, item) => ({
      calories: acc.calories + item.calories,
      protein: acc.protein + item.protein,
      carbs: acc.carbs + item.carbs,
      fat: acc.fat + item.fat,
      fiber: acc.fiber + item.fiber
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
  );
}

function sumMealsNutrition(meals: MealLog[]): NutritionInfo {
  return meals.reduce(
    (acc, meal) => ({
      calories: acc.calories + meal.totalCalories,
      protein: acc.protein + meal.totalProtein,
      carbs: acc.carbs + meal.totalCarbs,
      fat: acc.fat + meal.totalFat,
      fiber: acc.fiber + meal.totalFiber
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatTime(dateIso: string): string {
  const d = new Date(dateIso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function groupByDay(meals: MealLog[]): Array<{ key: string; title: string; meals: MealLog[] }> {
  const map = new Map<string, MealLog[]>();
  for (const meal of meals) {
    const key = meal.date.slice(0, 10);
    const current = map.get(key) ?? [];
    current.push(meal);
    map.set(key, current);
  }

  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, list]) => ({
      key,
      title: labelForDay(list[0]?.date ?? key),
      meals: list.sort((a, b) => (a.date < b.date ? 1 : -1))
    }));
}

function labelForDay(dateIso: string): string {
  if (isToday(dateIso)) return "Today";
  if (isYesterday(dateIso)) return "Yesterday";
  return new Date(dateIso).toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric"
  });
}

function clamp(value: unknown, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Math.random().toString(36).slice(2, 10)}`;
}
