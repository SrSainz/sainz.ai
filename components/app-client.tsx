"use client";

import Image from "next/image";
import { ChangeEvent, CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { categoryEmoji, categoryForFood, hasKnownFoodMatch, lookupNutrition } from "@/lib/nutrition-db";
import { compressImageToBase64 } from "@/lib/image";
import { addMeal, deleteMeal, isToday, isYesterday, loadMeals } from "@/lib/storage";
import { DetectedFood, GeminiFoodItem, GeminiFoodResponse, MealLog, NutritionInfo } from "@/lib/types";

type Goals = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

type HealthSex = "hombre" | "mujer";
type ActivityLevel = "sedentario" | "ligero" | "moderado" | "alto";

type HealthProfile = {
  age: number;
  weightKg: number;
  heightCm: number;
  sex: HealthSex;
  activity: ActivityLevel;
};

const DEFAULT_GOALS: Goals = {
  calories: 2000,
  protein: 150,
  carbs: 250,
  fat: 65
};
const GOALS_KEY = "sainzcal_goals_v1";
const PROFILE_KEY = "sainzcal_health_profile_v1";
const PORTION_MEMORY_KEY = "sainzcal_portion_memory_v1";
const API_USAGE_KEY = "sainzcal_gemini_api_usage_v1";
const LOW_CONFIDENCE_THRESHOLD = 0.7;

type Tab = "home" | "history" | "health";
type ScanPhase = "picker" | "analyzing" | "result";

type AnalyzeErrorPayload = {
  error?: string;
  quotaExceeded?: boolean;
  retryAfterSeconds?: number | null;
  dailyResetSeconds?: number | null;
  quotaScopes?: string[];
  model?: string | null;
  modelCandidates?: string[];
};

export default function AppClient() {
  const [tab, setTab] = useState<Tab>("home");
  const [meals, setMeals] = useState<MealLog[]>([]);

  const [scanOpen, setScanOpen] = useState(false);
  const [scanPhase, setScanPhase] = useState<ScanPhase>("picker");
  const [selectedImageDataUrl, setSelectedImageDataUrl] = useState<string>("");
  const [detectedFoods, setDetectedFoods] = useState<DetectedFood[]>([]);
  const [mealName, setMealName] = useState(mealPeriodLabel(new Date()));
  const [scanError, setScanError] = useState<string>("");
  const [scanWarning, setScanWarning] = useState<string>("");
  const [analysisSource, setAnalysisSource] = useState<string>("");
  const [analysisModel, setAnalysisModel] = useState<string>("");
  const [saveError, setSaveError] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [requiresSaveConfirmation, setRequiresSaveConfirmation] = useState(false);
  const [saveConfirmed, setSaveConfirmed] = useState(true);
  const [goals, setGoals] = useState<Goals>(DEFAULT_GOALS);
  const [showGoals, setShowGoals] = useState(false);
  const [profile, setProfile] = useState<HealthProfile | null>(null);
  const [showHealthProfile, setShowHealthProfile] = useState(false);
  const [apiUsageToday, setApiUsageToday] = useState(0);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [quotaRetryUntilMs, setQuotaRetryUntilMs] = useState<number | null>(null);
  const [quotaInfoMessage, setQuotaInfoMessage] = useState("");
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [lastImageBase64, setLastImageBase64] = useState("");
  const [lastImageMimeType, setLastImageMimeType] = useState("image/jpeg");

  const [detailMeal, setDetailMeal] = useState<MealLog | null>(null);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMeals(loadMeals());
    const parsedGoals = loadGoals();
    const storedProfile = loadHealthProfile();
    setApiUsageToday(getApiUsageCountTodayPacific());
    setProfile(storedProfile);
    if (storedProfile) {
      const recommended = buildGoalsFromProfile(storedProfile);
      setGoals(recommended);
      saveGoals(recommended);
    } else {
      setGoals(parsedGoals);
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClockMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const todayMeals = useMemo(() => meals.filter((meal) => isToday(meal.date)), [meals]);
  const todayNutrition = useMemo(() => sumMealsNutrition(todayMeals), [todayMeals]);

  const historyGroups = useMemo(() => groupByDay(meals), [meals]);

  function openScan() {
    setScanOpen(true);
    setScanPhase("picker");
    setSelectedImageDataUrl("");
    setDetectedFoods([]);
    setMealName(mealPeriodLabel(new Date()));
    setScanError("");
    setScanWarning("");
    setAnalysisSource("");
    setAnalysisModel("");
    setSaveError("");
    setIsSaving(false);
    setRequiresSaveConfirmation(false);
    setSaveConfirmed(true);
    setLastImageBase64("");
    setLastImageMimeType("image/jpeg");
  }

  function closeScan() {
    setScanOpen(false);
    setScanPhase("picker");
    setScanError("");
    setScanWarning("");
    setAnalysisSource("");
    setAnalysisModel("");
    setSaveError("");
    setIsSaving(false);
    setRequiresSaveConfirmation(false);
    setSaveConfirmed(true);
    setLastImageBase64("");
    setLastImageMimeType("image/jpeg");
  }

  async function onImagePicked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";

    try {
      const base64 = await compressImageToBase64(file, 1280, 1_500_000);
      const mimeType = "image/jpeg";
      setSelectedImageDataUrl(`data:${mimeType};base64,${base64}`);
      setLastImageBase64(base64);
      setLastImageMimeType(mimeType);
      await runAnalyze(base64, mimeType);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error inesperado al analizar la imagen.";
      setScanError(message);
      setScanPhase("picker");
    }
  }

  async function retryLastAnalyze() {
    if (!lastImageBase64) return;
    setSelectedImageDataUrl(`data:${lastImageMimeType};base64,${lastImageBase64}`);
    try {
      await runAnalyze(lastImageBase64, lastImageMimeType);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error inesperado al analizar la imagen.";
      setScanError(message);
      setScanPhase("picker");
    }
  }

  async function runAnalyze(base64: string, mimeType: string) {
    setScanError("");
    setScanWarning("");
    setSaveError("");
    setScanPhase("analyzing");

    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageBase64: base64,
        mimeType
      })
    });

    const usageCount = registerApiUsageAttempt();
    setApiUsageToday(usageCount);

    if (!response.ok) {
      const errorPayload = (await response.json().catch(() => null)) as AnalyzeErrorPayload | null;
      const retryAfterSeconds =
        typeof errorPayload?.retryAfterSeconds === "number" && errorPayload.retryAfterSeconds > 0
          ? Math.ceil(errorPayload.retryAfterSeconds)
          : null;
      if (retryAfterSeconds) {
        setQuotaRetryUntilMs(Date.now() + retryAfterSeconds * 1000);
      } else {
        setQuotaRetryUntilMs(null);
      }
      setQuotaExceeded(Boolean(errorPayload?.quotaExceeded));
      setQuotaInfoMessage(buildQuotaInfoMessage(errorPayload));
      throw new Error(errorPayload?.error || "Error al analizar la imagen.");
    }

    const payload = (await response.json()) as GeminiFoodResponse & {
      warning?: string;
      source?: string;
      model?: string;
    };
    setQuotaExceeded(false);
    setQuotaRetryUntilMs(null);
    setQuotaInfoMessage("");
    const rawFoods = (payload.foods || []).map(mapGeminiFoodToDetectedFood).filter(Boolean) as DetectedFood[];
    const foods = mergeSimilarFoods(rawFoods);

    if (foods.length === 0) {
      throw new Error("No se detectaron alimentos. Prueba con una foto mas clara.");
    }

    setDetectedFoods(foods);
    const hasLowConfidence = foods.some((food) => food.confidence < LOW_CONFIDENCE_THRESHOLD);
    setRequiresSaveConfirmation(hasLowConfidence);
    setSaveConfirmed(!hasLowConfidence);
    if (payload.warning) setScanWarning(payload.warning);
    setAnalysisSource(payload.source || "gemini");
    setAnalysisModel(payload.model || "");
    setMealName(buildMealNameForCurrentTime(suggestMealName(foods), new Date()));
    setScanPhase("result");
  }

  function updateFoodGrams(id: string, grams: number) {
    if (!Number.isFinite(grams) || grams <= 0) return;
    const nextFoods = detectedFoods.map((food) => {
      if (food.id !== id) return food;
      const factor = grams / Math.max(food.estimatedGrams, 1);
      rememberPortionAdjustment(food.name, food.estimatedGrams, grams);
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
    });

    setDetectedFoods(nextFoods);
    if (requiresSaveConfirmation) {
      setSaveConfirmed(true);
    }
  }

  function removeFood(id: string) {
    const nextFoods = detectedFoods.filter((food) => food.id !== id);
    setDetectedFoods(nextFoods);
    const stillNeedsConfirmation = nextFoods.some((food) => food.confidence < LOW_CONFIDENCE_THRESHOLD);
    setRequiresSaveConfirmation(stillNeedsConfirmation);
    if (!stillNeedsConfirmation) {
      setSaveConfirmed(true);
    }
  }

  function saveCurrentMeal() {
    if (detectedFoods.length === 0 || isSaving) return;
    if (requiresSaveConfirmation && !saveConfirmed) {
      setSaveError("Confirma las porciones antes de guardar. La confianza de la IA es baja en algunos alimentos.");
      return;
    }
    setIsSaving(true);
    setSaveError("");

    try {
      const totals = sumNutrition(detectedFoods.map((food) => food.nutrition));
      const finalMealName = buildMealNameForCurrentTime(mealName, new Date());
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
        mealName: finalMealName
      };

      const updated = addMeal(meal);
      setMeals(updated);
      setTab("home");
      closeScan();
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo guardar la comida.";
      setSaveError(message);
      setScanPhase("result");
    } finally {
      setIsSaving(false);
    }
  }

  function removeMealFromHistory(id: string) {
    const updated = deleteMeal(id);
    setMeals(updated);
    if (detailMeal?.id === id) setDetailMeal(null);
  }

  const progress = Math.min(todayNutrition.calories / Math.max(goals.calories, 1), 1);
  const progressStyle = {
    "--progress": Math.round(progress * 100)
  } as CSSProperties;
  const quotaRetryLeftSeconds = quotaRetryUntilMs ? Math.max(0, Math.ceil((quotaRetryUntilMs - clockMs) / 1000)) : 0;
  const apiResetLeftSeconds = secondsUntilPacificMidnight(new Date(clockMs));

  return (
    <>
      <main className="app-shell">
        {tab === "home" ? (
          <HomeScreen
            todayMeals={todayMeals}
            todayNutrition={todayNutrition}
            progressStyle={progressStyle}
            goals={goals}
            profile={profile}
            onOpenGoals={() => setShowGoals(true)}
          />
        ) : null}
        {tab === "history" ? (
          <HistoryScreen
            groups={historyGroups}
            onOpenDetail={setDetailMeal}
            onDelete={removeMealFromHistory}
          />
        ) : null}
        {tab === "health" ? (
          <HealthScreen
            profile={profile}
            goals={goals}
            todayNutrition={todayNutrition}
            onOpenProfile={() => setShowHealthProfile(true)}
            onApplyProfileGoals={() => {
              if (!profile) return;
              const recommended = buildGoalsFromProfile(profile);
              setGoals(recommended);
              saveGoals(recommended);
            }}
          />
        ) : null}
      </main>

      <nav className="tabbar">
        <div className="tabbar-inner">
          <button
            className={`tab-btn ${tab === "home" ? "active" : ""}`}
            type="button"
            onClick={() => setTab("home")}
          >
            <span>{"\u{1F3E0}"}</span>
            <span className="tiny">Inicio</span>
          </button>

          <button className="scan-main-btn" type="button" onClick={openScan} aria-label="Escanear comida">
            {"\u{1F4F7}"}
          </button>

          <button
            className={`tab-btn ${tab === "history" ? "active" : ""}`}
            type="button"
            onClick={() => setTab("history")}
          >
            <span>{"\u{1F4CA}"}</span>
            <span className="tiny">Historial</span>
          </button>

          <button
            className={`tab-btn ${tab === "health" ? "active" : ""}`}
            type="button"
            onClick={() => setTab("health")}
          >
            <span>{"\u{2764}\u{FE0F}"}</span>
            <span className="tiny">Salud</span>
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
          saveError={saveError}
          isSaving={isSaving}
          requiresSaveConfirmation={requiresSaveConfirmation}
          saveConfirmed={saveConfirmed}
          apiUsageToday={apiUsageToday}
          apiResetLeftSeconds={apiResetLeftSeconds}
          quotaExceeded={quotaExceeded}
          quotaRetryLeftSeconds={quotaRetryLeftSeconds}
          quotaInfoMessage={quotaInfoMessage}
          source={analysisSource}
          model={analysisModel}
          cameraInputRef={cameraInputRef}
          galleryInputRef={galleryInputRef}
          onClose={closeScan}
          onImagePicked={onImagePicked}
          onRetryAnalyze={retryLastAnalyze}
          onMealNameChange={setMealName}
          onUpdateGrams={updateFoodGrams}
          onDeleteFood={removeFood}
          onSave={saveCurrentMeal}
          onSaveConfirmedChange={setSaveConfirmed}
          onRetake={() => {
            setScanPhase("picker");
            setDetectedFoods([]);
            setScanWarning("");
            setScanError("");
            setSaveError("");
            setAnalysisSource("");
            setAnalysisModel("");
            setMealName(mealPeriodLabel(new Date()));
            setRequiresSaveConfirmation(false);
            setSaveConfirmed(true);
            setLastImageBase64("");
            setLastImageMimeType("image/jpeg");
          }}
        />
      )}

      {detailMeal && (
        <MealDetailModal meal={detailMeal} onClose={() => setDetailMeal(null)} />
      )}

      {showGoals && (
        <GoalsModal
          goals={goals}
          onClose={() => setShowGoals(false)}
          onSave={(nextGoals) => {
            setGoals(nextGoals);
            saveGoals(nextGoals);
            setShowGoals(false);
          }}
        />
      )}

      {showHealthProfile && (
        <HealthProfileModal
          profile={profile}
          onClose={() => setShowHealthProfile(false)}
          onSave={(nextProfile) => {
            setProfile(nextProfile);
            saveHealthProfile(nextProfile);
            const recommended = buildGoalsFromProfile(nextProfile);
            setGoals(recommended);
            saveGoals(recommended);
            setShowHealthProfile(false);
          }}
        />
      )}
    </>
  );
}

function HomeScreen({
  todayMeals,
  todayNutrition,
  progressStyle,
  goals,
  profile,
  onOpenGoals
}: {
  todayMeals: MealLog[];
  todayNutrition: NutritionInfo;
  progressStyle: CSSProperties;
  goals: Goals;
  profile: HealthProfile | null;
  onOpenGoals: () => void;
}) {
  const greeting = getGreeting();
  const remaining = Math.max(0, goals.calories - todayNutrition.calories);
  const health = evaluateHealthStatus(todayNutrition, goals, profile);

  return (
    <>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
        <div>
          <div className="brand-chip">Sainz.ai</div>
          <p className="muted" style={{ margin: 0, fontSize: "1.08rem", fontWeight: 700 }}>
            {greeting}
          </p>
          <h1 className="screen-title">Nutricion de hoy</h1>
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
          {"\u{1F33F}"}
        </div>
      </header>
      <div style={{ marginBottom: "0.8rem", display: "flex", justifyContent: "center" }}>
        <button type="button" className="btn secondary" onClick={onOpenGoals}>
          Objetivos
        </button>
      </div>

      <section className="card">
        <div className="macro-ring-wrap">
          <div className="ring" style={progressStyle}>
            <div className="ring-center">
              <div>
                <div style={{ fontSize: "2.7rem", fontWeight: 800, lineHeight: 1 }}>{Math.round(todayNutrition.calories)}</div>
                <div className="muted">kcal</div>
                <div style={{ color: "var(--neon)", fontSize: "0.8rem", fontWeight: 700 }}>{Math.round(remaining)} restantes</div>
              </div>
            </div>
          </div>
        </div>

        <div className="macro-pills">
          <MacroPill label="Proteina" value={todayNutrition.protein} color="var(--protein)" />
          <MacroPill label="Carbohidratos" value={todayNutrition.carbs} color="var(--carbs)" />
          <MacroPill label="Grasa" value={todayNutrition.fat} color="var(--fat)" />
        </div>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <div className="section-head">
          <h2 style={{ margin: 0 }}>Resumen de macros</h2>
          <span className="muted">{todayMeals.length} comidas</span>
        </div>
        <MacroRow label="Proteina" value={todayNutrition.protein} goal={goals.protein} color="var(--protein)" />
        <MacroRow label="Carbohidratos" value={todayNutrition.carbs} goal={goals.carbs} color="var(--carbs)" />
        <MacroRow label="Grasa" value={todayNutrition.fat} goal={goals.fat} color="var(--fat)" />
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <div className="section-head">
          <h2 style={{ margin: 0 }}>Coach Sainz.ai</h2>
          <span className="muted tiny">Sugerencia del dia</span>
        </div>
        <p className="muted" style={{ margin: 0, lineHeight: 1.45 }}>
          {buildDailyInsight(todayNutrition, goals)}
        </p>
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <div className="section-head">
          <h2 style={{ margin: 0 }}>Salud e IMC</h2>
          <span className={`status-chip ${health.bmi.isHealthy ? "ok" : "warn"}`}>{health.bmi.label}</span>
        </div>
        {profile ? (
          <>
            <div className="health-grid">
              <div className="health-cell">
                <div className="muted tiny">IMC</div>
                <div className="health-value">{health.bmi.value.toFixed(1)}</div>
              </div>
              <div className="health-cell">
                <div className="muted tiny">Metabolismo</div>
                <div className="health-value">{Math.round(health.tdee)} kcal</div>
              </div>
              <div className="health-cell">
                <div className="muted tiny">Dieta de hoy</div>
                <div className={`health-value ${health.dietHealthy ? "text-ok" : "text-warn"}`}>
                  {health.dietHealthy ? "Saludable" : "Mejorable"}
                </div>
              </div>
            </div>
            <p className="muted" style={{ margin: "0.7rem 0 0", lineHeight: 1.45 }}>
              {health.message}
            </p>
          </>
        ) : (
          <p className="muted" style={{ margin: 0, lineHeight: 1.45 }}>
            Completa tu perfil de salud (edad, peso, altura, sexo y actividad) para calcular IMC y evaluar tu dieta.
          </p>
        )}
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <div className="section-head">
          <h2 style={{ margin: 0 }}>Comidas de hoy</h2>
          <span className="muted">{todayMeals.length}</span>
        </div>
        {todayMeals.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No hay comidas registradas hoy.
          </p>
        ) : (
          todayMeals.map((meal) => (
            <div key={meal.id} className="meal-row meal-row-compact">
              {meal.imageDataUrl ? (
                <Image className="thumb" src={meal.imageDataUrl} alt={meal.mealName} width={52} height={52} unoptimized />
              ) : (
                <div className="thumb" />
              )}
              <div className="meal-main">
                <p className="meal-title">{meal.mealName}</p>
                <p className="meal-meta muted tiny">
                  {formatTime(meal.date)}
                </p>
              </div>
              <div className="meal-actions">
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

function HealthScreen({
  profile,
  goals,
  todayNutrition,
  onOpenProfile,
  onApplyProfileGoals
}: {
  profile: HealthProfile | null;
  goals: Goals;
  todayNutrition: NutritionInfo;
  onOpenProfile: () => void;
  onApplyProfileGoals: () => void;
}) {
  const health = evaluateHealthStatus(todayNutrition, goals, profile);
  const recommended = profile ? buildGoalsFromProfile(profile) : null;

  return (
    <>
      <header style={{ marginBottom: "1rem" }}>
        <div className="brand-chip">Sainz.ai</div>
        <h1 className="screen-title">Perfil de salud</h1>
        <p className="muted" style={{ margin: "0.35rem 0 0" }}>
          IMC, metabolismo y objetivos ajustados a tu perfil.
        </p>
      </header>

      <section className="card health-focus-card">
        <div className="section-head">
          <h2 style={{ margin: 0 }}>Estado general</h2>
          <span className={`status-chip ${health.dietHealthy && health.bmi.isHealthy ? "ok" : "warn"}`}>
            {health.dietHealthy ? "Dieta bien" : "Dieta mejorable"}
          </span>
        </div>
        {profile ? (
          <>
            <div className="health-grid">
              <div className="health-cell">
                <div className="muted tiny">IMC</div>
                <div className="health-value">{health.bmi.value.toFixed(1)}</div>
                <div className="tiny muted">{health.bmi.label}</div>
              </div>
              <div className="health-cell">
                <div className="muted tiny">TDEE estimado</div>
                <div className="health-value">{Math.round(health.tdee)} kcal</div>
                <div className="tiny muted">gasto diario</div>
              </div>
              <div className="health-cell">
                <div className="muted tiny">Hoy</div>
                <div className={`health-value ${health.dietHealthy ? "text-ok" : "text-warn"}`}>
                  {health.dietHealthy ? "Saludable" : "Mejorable"}
                </div>
                <div className="tiny muted">{Math.round(todayNutrition.calories)} kcal</div>
              </div>
            </div>
            <p className="muted" style={{ margin: "0.8rem 0 0", lineHeight: 1.45 }}>
              {health.message}
            </p>
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Completa tu perfil para calcular IMC y recomendaciones.
          </p>
        )}
      </section>

      <section className="card" style={{ marginTop: "1rem" }}>
        <div className="section-head">
          <h2 style={{ margin: 0 }}>Objetivos recomendados</h2>
          <span className="muted tiny">segun perfil</span>
        </div>
        {recommended ? (
          <>
            <div className="goal-grid">
              <div className="goal-cell">
                <span className="tiny muted">Calorias</span>
                <strong>{Math.round(recommended.calories)} kcal</strong>
              </div>
              <div className="goal-cell">
                <span className="tiny muted">Proteina</span>
                <strong>{Math.round(recommended.protein)} g</strong>
              </div>
              <div className="goal-cell">
                <span className="tiny muted">Carbohidratos</span>
                <strong>{Math.round(recommended.carbs)} g</strong>
              </div>
              <div className="goal-cell">
                <span className="tiny muted">Grasa</span>
                <strong>{Math.round(recommended.fat)} g</strong>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.7rem", marginTop: "0.85rem" }}>
              <button type="button" className="btn secondary" onClick={onOpenProfile}>
                Editar perfil
              </button>
              <button type="button" className="btn primary" onClick={onApplyProfileGoals}>
                Aplicar objetivos
              </button>
            </div>
          </>
        ) : (
          <button type="button" className="btn primary" onClick={onOpenProfile}>
            Completar perfil
          </button>
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
        <h1 className="screen-title">Historial</h1>
      </header>

      {groups.length === 0 ? (
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>
            No hay historial todavia. Guarda tu primer escaneo.
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
                <div key={meal.id} className="meal-row history-meal-row">
                  {meal.imageDataUrl ? (
                    <Image className="thumb" src={meal.imageDataUrl} alt={meal.mealName} width={52} height={52} unoptimized />
                  ) : (
                    <div className="thumb" />
                  )}
                  <button
                    type="button"
                    className="meal-main meal-main-btn"
                    onClick={() => onOpenDetail(meal)}
                  >
                    <p className="meal-title">{meal.mealName}</p>
                    <p className="meal-meta muted tiny">
                      {formatTime(meal.date)} - P {Math.round(meal.totalProtein)}g / C {Math.round(meal.totalCarbs)}g / F{" "}
                      {Math.round(meal.totalFat)}g
                    </p>
                  </button>
                  <div className="meal-actions">
                    <div className="kcal">{Math.round(meal.totalCalories)}</div>
                    <button
                      type="button"
                      onClick={() => onDelete(meal.id)}
                      className="delete-btn"
                    >
                      Eliminar
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
  saveError,
  isSaving,
  requiresSaveConfirmation,
  saveConfirmed,
  apiUsageToday,
  apiResetLeftSeconds,
  quotaExceeded,
  quotaRetryLeftSeconds,
  quotaInfoMessage,
  source,
  model,
  cameraInputRef,
  galleryInputRef,
  onClose,
  onImagePicked,
  onRetryAnalyze,
  onMealNameChange,
  onUpdateGrams,
  onDeleteFood,
  onSave,
  onSaveConfirmedChange,
  onRetake
}: {
  phase: ScanPhase;
  imageDataUrl: string;
  foods: DetectedFood[];
  mealName: string;
  warning: string;
  error: string;
  saveError: string;
  isSaving: boolean;
  requiresSaveConfirmation: boolean;
  saveConfirmed: boolean;
  apiUsageToday: number;
  apiResetLeftSeconds: number;
  quotaExceeded: boolean;
  quotaRetryLeftSeconds: number;
  quotaInfoMessage: string;
  source: string;
  model: string;
  cameraInputRef: React.RefObject<HTMLInputElement | null>;
  galleryInputRef: React.RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onImagePicked: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
  onRetryAnalyze: () => Promise<void>;
  onMealNameChange: (name: string) => void;
  onUpdateGrams: (id: string, grams: number) => void;
  onDeleteFood: (id: string) => void;
  onSave: () => void;
  onSaveConfirmedChange: (value: boolean) => void;
  onRetake: () => void;
}) {
  const totals = sumNutrition(foods.map((food) => food.nutrition));
  const avgConfidence = foods.length ? foods.reduce((acc, food) => acc + food.confidence, 0) / foods.length : 0;
  const calidadIA = avgConfidence >= 0.85 ? "Alta" : avgConfidence >= 0.65 ? "Media" : "Baja";
  const mealHealth = evaluateMealHealthScore(foods);

  return (
    <div className="overlay">
      <div className="modal">
        <div className="brand-mark">Sainz.ai</div>
        <div className="section-head">
          <strong>{phase === "result" ? "Resultado del escaneo" : "Escanear comida"}</strong>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cerrar
          </button>
        </div>

        <section className="card api-usage-card">
          <div className="section-head" style={{ marginBottom: "0.45rem" }}>
            <strong>Uso de Gemini</strong>
            <span className="muted tiny">contador local</span>
          </div>
          <p className="muted tiny" style={{ margin: "0 0 0.35rem" }}>
            Solicitudes hoy: <strong>{apiUsageToday}</strong>
          </p>
          <p className="muted tiny" style={{ margin: 0 }}>
            Reinicio cuota diaria (RPD): {formatDurationCompact(apiResetLeftSeconds)} (medianoche PT)
          </p>
          {quotaExceeded ? (
            <p className="tiny" style={{ margin: "0.45rem 0 0", color: "var(--carbs)" }}>
              Cuota agotada{quotaRetryLeftSeconds > 0 ? ` · reintento sugerido en ${formatDurationCompact(quotaRetryLeftSeconds)}` : ""}.
            </p>
          ) : null}
          {quotaInfoMessage ? (
            <p className="muted tiny" style={{ margin: "0.35rem 0 0" }}>
              {quotaInfoMessage}
            </p>
          ) : null}
        </section>

        {phase === "picker" && (
          <>
            <section className="card" style={{ marginBottom: "0.8rem" }}>
              <p style={{ marginTop: 0, fontWeight: 700, fontSize: "1.1rem" }}>Haz una foto de tu comida</p>
              <p className="muted">
                Toma una foto o elige una imagen de tu galeria. Modo precision: Gemini detecta alimentos y gramos, y los
                macros se calculan con base nutricional.
              </p>
              <div className="scan-actions">
                <button type="button" className="btn primary" onClick={() => cameraInputRef.current?.click()}>
                  Tomar foto
                </button>
                <button type="button" className="btn secondary" onClick={() => galleryInputRef.current?.click()}>
                  Elegir de galeria
                </button>
              </div>
            </section>

            {error ? (
              <section className="card" style={{ borderColor: "rgba(255,110,110,0.45)" }}>
                <strong style={{ color: "#ff8f8f" }}>No se pudo detectar comida</strong>
                <p className="muted" style={{ marginBottom: 0 }}>
                  {error}
                </p>
                <div style={{ marginTop: "0.65rem" }}>
                  <button type="button" className="btn secondary" onClick={onRetryAnalyze}>
                    Reintentar analisis
                  </button>
                </div>
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
            <h3 style={{ marginTop: 0 }}>Analizando tu comida...</h3>
            <p className="muted" style={{ marginBottom: 0 }}>
              La IA esta identificando alimentos y calculando nutricion.
            </p>
            {imageDataUrl ? (
              <Image
                src={imageDataUrl}
                alt="Comida seleccionada"
                className="result-image"
                style={{ marginTop: "1rem", height: 130 }}
                width={1200}
                height={800}
                sizes="100vw"
                unoptimized
              />
            ) : null}
          </section>
        )}

        {phase === "result" && (
          <>
            {imageDataUrl ? (
              <Image
                src={imageDataUrl}
                alt="Resultado del escaneo"
                className="result-image"
                width={1200}
                height={800}
                sizes="100vw"
                unoptimized
              />
            ) : null}

            {warning ? (
              <section className="card" style={{ marginTop: "0.8rem", borderColor: "rgba(255,196,71,0.55)" }}>
                <strong style={{ color: "var(--carbs)" }}>Nota del analisis</strong>
                <p className="muted" style={{ marginBottom: 0 }}>
                  {warning}
                </p>
              </section>
            ) : null}

            <section className="card" style={{ marginTop: "0.8rem" }}>
              <div className="section-head">
                <strong>Nutricion total</strong>
                <span className="muted">{foods.length} elementos</span>
              </div>
              {source ? (
                <div className="ia-chip">
                  IA: {source === "gemini" ? "Gemini" : source}
                  {model ? ` (${model})` : ""}
                </div>
              ) : null}
              {foods.length > 0 ? (
                <div className="quality-chip">Calidad IA: {calidadIA} ({Math.round(avgConfidence * 100)}%)</div>
              ) : null}
              <div className="precision-chip">Modo precision activo</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.4rem", textAlign: "center" }}>
                <div>
                  <div className="kcal">{Math.round(totals.calories)}</div>
                  <div className="tiny muted">Calorias</div>
                </div>
                <div>
                  <div>{Math.round(totals.protein)}g</div>
                  <div className="tiny muted">Proteina</div>
                </div>
                <div>
                  <div>{Math.round(totals.carbs)}g</div>
                  <div className="tiny muted">Carbohidratos</div>
                </div>
                <div>
                  <div>{Math.round(totals.fat)}g</div>
                  <div className="tiny muted">Grasa</div>
                </div>
              </div>
            </section>

            <section className="card yuka-card" style={{ marginTop: "0.8rem" }}>
              <div className="section-head">
                <strong>Indice de salud</strong>
                <span className={`yuka-grade yuka-${mealHealth.grade.toLowerCase()}`}>{mealHealth.grade}</span>
              </div>
              <div className="yuka-score">{mealHealth.score}/100</div>
              <p className="muted" style={{ margin: "0.35rem 0 0" }}>
                {mealHealth.summary}
              </p>
              <div className="yuka-tags">
                {mealHealth.highlights.map((item) => (
                  <span key={item} className="yuka-tag">
                    {item}
                  </span>
                ))}
              </div>
            </section>

            <section className="card" style={{ marginTop: "0.8rem" }}>
              <label htmlFor="meal-name" className="tiny muted">
                Nombre de la comida
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
                <strong>Alimentos detectados</strong>
                <span className="muted tiny">Edita gramos</span>
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
              {requiresSaveConfirmation ? (
                <section className="card" style={{ gridColumn: "1 / -1", borderColor: "rgba(255,196,71,0.55)" }}>
                  <strong style={{ color: "var(--carbs)" }}>Revision recomendada</strong>
                  <p className="muted" style={{ marginBottom: "0.5rem" }}>
                    Hay alimentos con confianza baja. Revisa gramos y confirma antes de guardar.
                  </p>
                  <label className="confirm-row">
                    <input
                      type="checkbox"
                      checked={saveConfirmed}
                      onChange={(e) => onSaveConfirmedChange(e.target.checked)}
                    />
                    <span>Confirmo que he revisado las porciones</span>
                  </label>
                </section>
              ) : null}
              <button type="button" className="btn secondary" onClick={onRetake}>
                Repetir
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={onSave}
                disabled={isSaving || (requiresSaveConfirmation && !saveConfirmed)}
              >
                {isSaving ? "Guardando..." : "Guardar comida"}
              </button>
            </div>
            {saveError ? (
              <section className="card" style={{ marginTop: "0.8rem", borderColor: "rgba(255,110,110,0.45)" }}>
                <strong style={{ color: "#ff8f8f" }}>Error al guardar</strong>
                <p className="muted" style={{ marginBottom: 0 }}>
                  {saveError}
                </p>
              </section>
            ) : null}
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
            Listo
          </button>
        </div>

        {meal.imageDataUrl ? (
          <Image
            className="result-image"
            src={meal.imageDataUrl}
            alt={meal.mealName}
            width={1200}
            height={800}
            sizes="100vw"
            unoptimized
          />
        ) : null}

        <section className="card" style={{ marginTop: "0.8rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", textAlign: "center", gap: "0.4rem" }}>
            <div>
              <div className="kcal">{Math.round(meal.totalCalories)}</div>
              <div className="tiny muted">Calorias</div>
            </div>
            <div>
              <div>{Math.round(meal.totalProtein)}g</div>
              <div className="tiny muted">Proteina</div>
            </div>
            <div>
              <div>{Math.round(meal.totalCarbs)}g</div>
              <div className="tiny muted">Carbohidratos</div>
            </div>
            <div>
              <div>{Math.round(meal.totalFat)}g</div>
              <div className="tiny muted">Grasa</div>
            </div>
          </div>
        </section>

        <section className="card" style={{ marginTop: "0.8rem" }}>
          <div className="section-head">
            <strong>Alimentos</strong>
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

function GoalsModal({
  goals,
  onClose,
  onSave
}: {
  goals: Goals;
  onClose: () => void;
  onSave: (goals: Goals) => void;
}) {
  const [draft, setDraft] = useState<Goals>(goals);

  return (
    <div className="overlay">
      <div className="modal">
        <div className="brand-mark">Sainz.ai</div>
        <div className="section-head">
          <strong>Objetivos diarios</strong>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cerrar
          </button>
        </div>
        <section className="card">
          <GoalInput
            label="Calorias"
            value={draft.calories}
            onChange={(v) => setDraft((p) => ({ ...p, calories: v }))}
          />
          <GoalInput
            label="Proteina (g)"
            value={draft.protein}
            onChange={(v) => setDraft((p) => ({ ...p, protein: v }))}
          />
          <GoalInput
            label="Carbohidratos (g)"
            value={draft.carbs}
            onChange={(v) => setDraft((p) => ({ ...p, carbs: v }))}
          />
          <GoalInput
            label="Grasa (g)"
            value={draft.fat}
            onChange={(v) => setDraft((p) => ({ ...p, fat: v }))}
          />
        </section>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.7rem", marginTop: "0.8rem" }}>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() =>
              onSave({
                calories: clamp(draft.calories, 1000, 6000),
                protein: clamp(draft.protein, 20, 500),
                carbs: clamp(draft.carbs, 20, 700),
                fat: clamp(draft.fat, 10, 300)
              })
            }
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

function GoalInput({
  label,
  value,
  onChange
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: "grid", gap: "0.3rem", marginBottom: "0.65rem" }}>
      <span className="tiny muted">{label}</span>
      <input
        type="number"
        min={1}
        value={Math.round(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: "100%",
          background: "#0f0f14",
          color: "white",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "0.75rem",
          padding: "0.65rem 0.8rem"
        }}
      />
    </label>
  );
}

function HealthProfileModal({
  profile,
  onClose,
  onSave
}: {
  profile: HealthProfile | null;
  onClose: () => void;
  onSave: (profile: HealthProfile) => void;
}) {
  const initial = profile ?? defaultHealthProfile();
  const [draft, setDraft] = useState<HealthProfile>(initial);

  return (
    <div className="overlay">
      <div className="modal">
        <div className="brand-mark">Sainz.ai</div>
        <div className="section-head">
          <strong>Perfil de salud</strong>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cerrar
          </button>
        </div>

        <section className="card">
          <GoalInput
            label="Edad"
            value={draft.age}
            onChange={(v) => setDraft((prev) => ({ ...prev, age: v }))}
          />
          <GoalInput
            label="Peso (kg)"
            value={draft.weightKg}
            onChange={(v) => setDraft((prev) => ({ ...prev, weightKg: v }))}
          />
          <GoalInput
            label="Altura (cm)"
            value={draft.heightCm}
            onChange={(v) => setDraft((prev) => ({ ...prev, heightCm: v }))}
          />

          <label style={{ display: "grid", gap: "0.3rem", marginBottom: "0.65rem" }}>
            <span className="tiny muted">Sexo</span>
            <select
              value={draft.sex}
              onChange={(e) => setDraft((prev) => ({ ...prev, sex: e.target.value as HealthSex }))}
              className="input-like"
            >
              <option value="hombre">Hombre</option>
              <option value="mujer">Mujer</option>
            </select>
          </label>

          <label style={{ display: "grid", gap: "0.3rem" }}>
            <span className="tiny muted">Actividad diaria</span>
            <select
              value={draft.activity}
              onChange={(e) => setDraft((prev) => ({ ...prev, activity: e.target.value as ActivityLevel }))}
              className="input-like"
            >
              <option value="sedentario">Sedentario</option>
              <option value="ligero">Ligero (1-3 dias/semana)</option>
              <option value="moderado">Moderado (3-5 dias/semana)</option>
              <option value="alto">Alto (6-7 dias/semana)</option>
            </select>
          </label>
        </section>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.7rem", marginTop: "0.8rem" }}>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() =>
              onSave({
                age: clamp(draft.age, 12, 100),
                weightKg: clamp(draft.weightKg, 30, 300),
                heightCm: clamp(draft.heightCm, 120, 240),
                sex: draft.sex,
                activity: draft.activity
              })
            }
          >
            Guardar perfil
          </button>
        </div>
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
  const foodHealth = evaluateFoodHealthScore(food);
  const [gramsText, setGramsText] = useState(String(Math.round(food.estimatedGrams)));

  function commitGrams(raw: string) {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) {
      onUpdateGrams(value);
      setGramsText(String(Math.round(value)));
      return;
    }
    setGramsText(String(Math.round(food.estimatedGrams)));
  }

  return (
    <div className="food-row">
      <div style={{ width: 34, textAlign: "center" }}>{categoryEmoji(food.category)}</div>
      <div style={{ flex: 1 }}>
        <p className="food-name">
          {food.name} <span className={`food-grade food-grade-${foodHealth.grade.toLowerCase()}`}>{foodHealth.grade}</span>
        </p>
        <p className="tiny muted" style={{ margin: 0 }}>
          <span className="kcal">{Math.round(food.nutrition.calories)} kcal</span> - P {Math.round(food.nutrition.protein)}g / C{" "}
          {Math.round(food.nutrition.carbs)}g / F {Math.round(food.nutrition.fat)}g
        </p>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <button
            type="button"
            onClick={() => {
              const next = Math.max(1, Math.round(food.estimatedGrams - 10));
              onUpdateGrams(next);
              setGramsText(String(next));
            }}
            style={gramAdjustButtonStyle}
          >
            -10
          </button>
          <input
            type="number"
            min={1}
            value={gramsText}
            onChange={(e) => setGramsText(e.target.value)}
            onBlur={(e) => commitGrams(e.target.value)}
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
          <button
            type="button"
            onClick={() => {
              const next = Math.round(food.estimatedGrams + 10);
              onUpdateGrams(next);
              setGramsText(String(next));
            }}
            style={gramAdjustButtonStyle}
          >
            +10
          </button>
        </div>
        <div className="tiny muted">gramos</div>
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
            Quitar
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

type VisionFoodPayload = GeminiFoodItem & {
  is_packaged?: boolean;
  brand?: string;
  product_name?: string;
  barcode?: string;
  nutrition_source?: "ai" | "db" | "product";
};

function mapGeminiFoodToDetectedFood(food: VisionFoodPayload): DetectedFood | null {
  const name = String(food.product_name ?? food.name ?? "").trim();
  if (!name) return null;

  const rawGrams = clamp(food.grams, 0, 2000);
  const aiCalories = clamp(food.calories, 0, 5000);
  const aiProtein = clamp(food.protein, 0, 500);
  const aiCarbs = clamp(food.carbs, 0, 500);
  const aiFat = clamp(food.fat, 0, 500);
  let confidence = Math.min(clamp(food.confidence, 0, 100), 97) / 100;
  const category = categoryForFood(name);
  const baseGrams = rawGrams > 0 ? rawGrams : 100;
  const sanitizedGrams = sanitizePortionGrams(name, category, baseGrams);
  const personalizedGrams = applyPersonalPortionFactor(name, sanitizedGrams);
  const safeGrams = clamp(personalizedGrams, 20, 2000);
  const knownFood = hasKnownFoodMatch(name);
  const isPackaged = Boolean(food.is_packaged) || food.nutrition_source === "product";

  const aiAdjustedStrongly = safeGrams / Math.max(baseGrams, 1) > 1.5 || safeGrams / Math.max(baseGrams, 1) < 0.65;
  if (aiAdjustedStrongly) {
    confidence = Math.max(0.45, confidence - 0.08);
  }

  const fallback = lookupNutrition(name, safeGrams);
  const aiNutrition: NutritionInfo = {
    calories: aiCalories,
    protein: aiProtein,
    carbs: aiCarbs,
    fat: aiFat,
    fiber: 0
  };
  const nutrition = choosePrecisionNutrition({
    knownFood,
    isPackaged,
    aiNutrition,
    fallbackNutrition: fallback,
    aiRawGrams: baseGrams,
    finalGrams: safeGrams
  });
  if (isPackaged) {
    confidence = Math.max(confidence, 0.95);
  }

  return {
    id: generateId(),
    name,
    estimatedGrams: safeGrams,
    confidence,
    category,
    nutrition
  };
}

function choosePrecisionNutrition(input: {
  knownFood: boolean;
  isPackaged: boolean;
  aiNutrition: NutritionInfo;
  fallbackNutrition: NutritionInfo;
  aiRawGrams: number;
  finalGrams: number;
}): NutritionInfo {
  if (input.isPackaged) {
    return {
      calories: Math.max(0, input.aiNutrition.calories),
      protein: Math.max(0, input.aiNutrition.protein),
      carbs: Math.max(0, input.aiNutrition.carbs),
      fat: Math.max(0, input.aiNutrition.fat),
      fiber: 0
    };
  }
  if (input.knownFood) return input.fallbackNutrition;

  const hasAiValues =
    input.aiNutrition.calories > 0 || input.aiNutrition.protein > 0 || input.aiNutrition.carbs > 0 || input.aiNutrition.fat > 0;
  if (!hasAiValues) return input.fallbackNutrition;

  const kcalPerGram = input.aiNutrition.calories / Math.max(input.aiRawGrams, 1);
  const plausibleDensity = kcalPerGram >= 0.2 && kcalPerGram <= 9;
  if (!plausibleDensity) return input.fallbackNutrition;

  const scale = input.finalGrams / Math.max(input.aiRawGrams, 1);
  return {
    calories: input.aiNutrition.calories * scale,
    protein: input.aiNutrition.protein * scale,
    carbs: input.aiNutrition.carbs * scale,
    fat: input.aiNutrition.fat * scale,
    fiber: 0
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
  if (hour < 12) return "Buenos dias";
  if (hour < 17) return "Buenas tardes";
  return "Buenas noches";
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
  if (isToday(dateIso)) return "Hoy";
  if (isYesterday(dateIso)) return "Ayer";
  return new Date(dateIso).toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric"
  });
}

function registerApiUsageAttempt(): number {
  if (typeof window === "undefined") return 0;
  const dayKey = pacificDayKey(new Date());
  const current = loadApiUsageCounter();
  if (current.dayKey !== dayKey) {
    const next = { dayKey, count: 1 };
    saveApiUsageCounter(next);
    return 1;
  }
  const nextCount = current.count + 1;
  saveApiUsageCounter({ dayKey, count: nextCount });
  return nextCount;
}

function getApiUsageCountTodayPacific(): number {
  if (typeof window === "undefined") return 0;
  const dayKey = pacificDayKey(new Date());
  const current = loadApiUsageCounter();
  return current.dayKey === dayKey ? current.count : 0;
}

function loadApiUsageCounter(): { dayKey: string; count: number } {
  if (typeof window === "undefined") return { dayKey: "", count: 0 };
  try {
    const raw = window.localStorage.getItem(API_USAGE_KEY);
    if (!raw) return { dayKey: "", count: 0 };
    const parsed = JSON.parse(raw) as { dayKey?: string; count?: number };
    return {
      dayKey: typeof parsed.dayKey === "string" ? parsed.dayKey : "",
      count: clamp(parsed.count, 0, 1_000_000)
    };
  } catch {
    return { dayKey: "", count: 0 };
  }
}

function saveApiUsageCounter(next: { dayKey: string; count: number }): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(API_USAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage write errors and keep app usable.
  }
}

function pacificDayKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "00";
  const day = parts.find((p) => p.type === "day")?.value ?? "00";
  return `${year}-${month}-${day}`;
}

function secondsUntilPacificMidnight(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(now);

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const second = Number(parts.find((p) => p.type === "second")?.value ?? "0");
  const elapsed = hour * 3600 + minute * 60 + second;
  return Math.max(1, 86_400 - elapsed);
}

function formatDurationCompact(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function buildQuotaInfoMessage(payload: AnalyzeErrorPayload | null): string {
  if (!payload) return "";
  const scopes = payload.quotaScopes ?? [];
  const scopeText =
    scopes.includes("day") && scopes.includes("minute")
      ? "minuto y dia"
      : scopes.includes("minute")
        ? "minuto"
        : scopes.includes("day")
          ? "dia"
          : "";
  const modelText = payload.model ? `Modelo: ${payload.model}. ` : "";
  const scopeInfo = scopeText ? `Cuota afectada: ${scopeText}. ` : "";
  const fallbackInfo =
    payload.modelCandidates && payload.modelCandidates.length > 1
      ? `Fallback activo: ${payload.modelCandidates.join(" -> ")}.`
      : "";
  return `${modelText}${scopeInfo}${fallbackInfo}`.trim();
}

function loadGoals(): Goals {
  if (typeof window === "undefined") return DEFAULT_GOALS;
  try {
    const raw = window.localStorage.getItem(GOALS_KEY);
    if (!raw) return DEFAULT_GOALS;
    const parsed = JSON.parse(raw) as Partial<Goals>;
    return {
      calories: clamp(parsed.calories, 1000, 6000),
      protein: clamp(parsed.protein, 20, 500),
      carbs: clamp(parsed.carbs, 20, 700),
      fat: clamp(parsed.fat, 10, 300)
    };
  } catch {
    return DEFAULT_GOALS;
  }
}

function saveGoals(goals: Goals): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GOALS_KEY, JSON.stringify(goals));
  } catch {
    // Ignore storage write errors and keep app usable.
  }
}

function defaultHealthProfile(): HealthProfile {
  return {
    age: 30,
    weightKg: 70,
    heightCm: 170,
    sex: "hombre",
    activity: "moderado"
  };
}

function loadHealthProfile(): HealthProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HealthProfile>;
    const sex: HealthSex = parsed.sex === "mujer" ? "mujer" : "hombre";
    const activity: ActivityLevel = isActivityLevel(parsed.activity) ? parsed.activity : "moderado";
    return {
      age: clamp(parsed.age, 12, 100),
      weightKg: clamp(parsed.weightKg, 30, 300),
      heightCm: clamp(parsed.heightCm, 120, 240),
      sex,
      activity
    };
  } catch {
    return null;
  }
}

function saveHealthProfile(profile: HealthProfile): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Ignore storage write errors and keep app usable.
  }
}

function isActivityLevel(value: unknown): value is ActivityLevel {
  return value === "sedentario" || value === "ligero" || value === "moderado" || value === "alto";
}

function evaluateHealthStatus(today: NutritionInfo, goals: Goals, profile: HealthProfile | null): {
  bmi: { value: number; label: string; isHealthy: boolean };
  tdee: number;
  dietHealthy: boolean;
  message: string;
} {
  if (!profile) {
    return {
      bmi: { value: 0, label: "Perfil pendiente", isHealthy: false },
      tdee: 0,
      dietHealthy: false,
      message: "Completa tu perfil para calcular tu IMC y evaluar la calidad de tu dieta diaria."
    };
  }

  const bmiValue = calculateBMI(profile.weightKg, profile.heightCm);
  const bmi = bmiStatus(bmiValue);
  const tdee = estimateTdee(profile);
  const targetCalories = Math.max(goals.calories, 1200);
  const calorieRatio = today.calories / Math.max(targetCalories, 1);
  const proteinTarget = Math.max(profile.weightKg * 1.2, goals.protein * 0.8);
  const fatPct = (today.fat * 9) / Math.max(today.calories, 1);
  const carbPct = (today.carbs * 4) / Math.max(today.calories, 1);

  const calorieOk = calorieRatio >= 0.75 && calorieRatio <= 1.2;
  const proteinOk = today.protein >= proteinTarget * 0.75;
  const macroSplitOk = fatPct >= 0.2 && fatPct <= 0.4 && carbPct >= 0.3 && carbPct <= 0.65;
  const enoughData = today.calories >= targetCalories * 0.45;
  const score = [calorieOk, proteinOk, macroSplitOk].filter(Boolean).length;
  const dietHealthy = enoughData && score >= 2;

  let message = "";
  if (!enoughData) {
    message = "Aun hay poca ingesta registrada hoy para evaluar tu dieta completa.";
  } else if (dietHealthy && bmi.isHealthy) {
    message = "Hoy vas en buena linea: dieta equilibrada y un IMC en rango saludable.";
  } else if (!dietHealthy && bmi.isHealthy) {
    message = "Tu IMC esta en buen rango, pero hoy la distribucion de macros/calorias se puede mejorar.";
  } else if (dietHealthy && !bmi.isHealthy) {
    message = "La dieta de hoy va bien, pero tu IMC esta fuera del rango saludable. Ajusta objetivos de forma progresiva.";
  } else {
    message = "Tanto tu IMC como la dieta de hoy son mejorables. Prioriza constancia y porciones realistas.";
  }

  return {
    bmi,
    tdee,
    dietHealthy,
    message
  };
}

function calculateBMI(weightKg: number, heightCm: number): number {
  const heightM = heightCm / 100;
  if (!Number.isFinite(heightM) || heightM <= 0) return 0;
  return weightKg / (heightM * heightM);
}

function bmiStatus(bmi: number): { value: number; label: string; isHealthy: boolean } {
  if (!Number.isFinite(bmi) || bmi <= 0) {
    return { value: 0, label: "Sin datos", isHealthy: false };
  }
  if (bmi < 18.5) {
    return { value: bmi, label: "IMC bajo", isHealthy: false };
  }
  if (bmi < 25) {
    return { value: bmi, label: "IMC bueno", isHealthy: true };
  }
  if (bmi < 30) {
    return { value: bmi, label: "Sobrepeso", isHealthy: false };
  }
  return { value: bmi, label: "Obesidad", isHealthy: false };
}

function estimateTdee(profile: HealthProfile): number {
  const baseBmr =
    profile.sex === "hombre"
      ? 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.age + 5
      : 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.age - 161;

  const multiplier = activityMultiplier(profile.activity);
  return Math.max(1200, baseBmr * multiplier);
}

function activityMultiplier(activity: ActivityLevel): number {
  switch (activity) {
    case "sedentario":
      return 1.2;
    case "ligero":
      return 1.375;
    case "moderado":
      return 1.55;
    case "alto":
      return 1.725;
    default:
      return 1.2;
  }
}

function buildGoalsFromProfile(profile: HealthProfile): Goals {
  const tdee = estimateTdee(profile);
  const proteinPerKg =
    profile.activity === "alto" ? 2.0 : profile.activity === "moderado" ? 1.8 : profile.activity === "ligero" ? 1.6 : 1.4;
  const protein = clamp(profile.weightKg * proteinPerKg, 60, 260);
  const fat = clamp((tdee * 0.28) / 9, 35, 130);
  const remainingForCarbs = tdee - protein * 4 - fat * 9;
  const carbs = clamp(remainingForCarbs / 4, 80, 450);

  return {
    calories: Math.round(tdee),
    protein: Math.round(protein),
    carbs: Math.round(carbs),
    fat: Math.round(fat)
  };
}

function mergeSimilarFoods(foods: DetectedFood[]): DetectedFood[] {
  const merged = new Map<string, DetectedFood>();

  for (const food of foods) {
    const key = `${food.category}:${normalizeFoodKey(food.name)}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...food });
      continue;
    }

    const totalGrams = existing.estimatedGrams + food.estimatedGrams;
    const weightedConfidence =
      (existing.confidence * existing.estimatedGrams + food.confidence * food.estimatedGrams) / Math.max(totalGrams, 1);

    merged.set(key, {
      ...existing,
      name: pickDisplayName(existing.name, food.name),
      estimatedGrams: totalGrams,
      confidence: Math.min(1, Math.max(0, weightedConfidence)),
      nutrition: sumNutrition([existing.nutrition, food.nutrition])
    });
  }

  return [...merged.values()].sort((a, b) => b.nutrition.calories - a.nutrition.calories);
}

function suggestMealName(foods: DetectedFood[]): string {
  if (foods.length === 0) return "Comida Sainz";

  const sorted = [...foods].sort((a, b) => b.nutrition.calories - a.nutrition.calories);
  const topNames = sorted.slice(0, 2).map((food) => toTitleCase(food.name));

  if (foods.length === 1) return topNames[0];
  if (foods.length === 2) return `${topNames[0]} + ${topNames[1]}`;

  const categories = new Set(foods.map((food) => food.category));
  if (categories.size === 1) {
    const only = foods[0].category;
    if (only === "fruit") return "Snack de fruta";
    if (only === "beverage") return "Bebida";
    if (only === "protein") return "Comida proteica";
  }

  return `${topNames[0]} + ${topNames[1]}`;
}

function mealPeriodLabel(date: Date): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return "Desayuno";
  if (hour >= 11 && hour < 16) return "Comida";
  if (hour >= 16 && hour < 20) return "Merienda";
  return "Cena";
}

function buildMealNameForCurrentTime(baseName: string, date: Date): string {
  const period = mealPeriodLabel(date);
  const clean = baseName.trim();
  if (!clean) return period;

  const existingPeriods = ["desayuno", "comida", "merienda", "cena"];
  const lower = clean.toLowerCase();
  if (existingPeriods.some((p) => lower.startsWith(p))) return clean;

  if (lower === "comida sainz" || lower === "comida") return period;

  return `${period} - ${clean}`;
}

function normalizeFoodKey(name: string): string {
  const stopWords = new Set(["de", "del", "la", "el", "con", "al", "a", "y"]);
  const tokens = name
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !stopWords.has(token));

  if (!tokens.length) return "comida";
  return tokens.slice(0, 3).join(" ");
}

function sanitizePortionGrams(name: string, category: DetectedFood["category"], grams: number): number {
  const key = normalizeFoodKey(name);
  let min = 20;
  let max = 900;

  switch (category) {
    case "fruit":
      min = 40;
      max = 350;
      break;
    case "vegetable":
      min = 30;
      max = 450;
      break;
    case "protein":
      min = 35;
      max = 500;
      break;
    case "carb":
      min = 40;
      max = 600;
      break;
    case "dairy":
      min = 30;
      max = 450;
      break;
    case "fat":
      min = 8;
      max = 120;
      break;
    case "beverage":
      min = 50;
      max = 700;
      break;
    default:
      min = 20;
      max = 900;
  }

  if (containsAny(key, ["platano", "banana"])) return clamp(grams, 70, 220);
  if (containsAny(key, ["manzana", "apple"])) return clamp(grams, 90, 280);
  if (containsAny(key, ["naranja", "orange"])) return clamp(grams, 90, 320);
  if (containsAny(key, ["huevo", "egg"])) return clamp(grams, 35, 120);
  if (containsAny(key, ["arroz", "rice"])) return clamp(grams, 50, 450);
  if (containsAny(key, ["pollo", "chicken"])) return clamp(grams, 60, 450);
  if (containsAny(key, ["brocoli", "broccoli"])) return clamp(grams, 40, 300);

  return clamp(grams, min, max);
}

function containsAny(value: string, words: string[]): boolean {
  return words.some((word) => value.includes(word));
}

function loadPortionMemory(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PORTION_MEMORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const n = Number(value);
      if (Number.isFinite(n)) {
        next[key] = clamp(n, 0.75, 1.25);
      }
    }
    return next;
  } catch {
    return {};
  }
}

function savePortionMemory(map: Record<string, number>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PORTION_MEMORY_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage write errors and keep app usable.
  }
}

function applyPersonalPortionFactor(name: string, grams: number): number {
  const key = normalizeFoodKey(name);
  const memory = loadPortionMemory();
  const factor = memory[key] ?? 1;
  return grams * factor;
}

function rememberPortionAdjustment(name: string, fromGrams: number, toGrams: number): void {
  if (fromGrams <= 0 || toGrams <= 0) return;
  const key = normalizeFoodKey(name);
  const newFactor = clamp(toGrams / fromGrams, 0.6, 1.6);
  const memory = loadPortionMemory();
  const current = memory[key] ?? 1;
  const smoothed = clamp(current * 0.7 + newFactor * 0.3, 0.75, 1.25);
  memory[key] = smoothed;
  savePortionMemory(memory);
}

function evaluateFoodHealthScore(food: DetectedFood): { score: number; grade: "A" | "B" | "C" | "D" | "E"; reasons: string[] } {
  const grams = Math.max(food.estimatedGrams, 1);
  const kcal100 = (food.nutrition.calories * 100) / grams;
  const protein100 = (food.nutrition.protein * 100) / grams;
  const carbs100 = (food.nutrition.carbs * 100) / grams;
  const fat100 = (food.nutrition.fat * 100) / grams;
  const fiber100 = (food.nutrition.fiber * 100) / grams;
  const key = normalizeFoodKey(food.name);

  let score = 60;
  const reasons: string[] = [];

  if (kcal100 > 320) {
    score -= 24;
    reasons.push("Alta densidad calorica");
  } else if (kcal100 > 220) {
    score -= 14;
  } else if (kcal100 < 90) {
    score += 8;
  }

  const estimatedSugar100 = food.category === "beverage" ? carbs100 : carbs100 * 0.45;
  if (estimatedSugar100 > 10) {
    score -= 20;
    reasons.push("Azucar estimado alto");
  } else if (estimatedSugar100 < 3) {
    score += 6;
  }

  if (fat100 > 18) {
    score -= 12;
  } else if (fat100 < 6) {
    score += 3;
  }

  if (fiber100 > 6) {
    score += 12;
    reasons.push("Fibra alta");
  } else if (fiber100 > 3) {
    score += 6;
  }

  if (protein100 > 12) {
    score += 8;
  } else if (protein100 > 7) {
    score += 4;
  }

  if (food.category === "fruit" || food.category === "vegetable") {
    score += 10;
    reasons.push("Alimento natural");
  }

  if (containsAny(key, ["cola", "refresco", "soda", "cookie", "chips", "bolleria", "snack"])) {
    score -= 16;
    reasons.push("Ultraprocesado probable");
  }

  const bounded = clamp(score, 0, 100);
  return {
    score: Math.round(bounded),
    grade: healthGradeFromScore(bounded),
    reasons
  };
}

function evaluateMealHealthScore(foods: DetectedFood[]): {
  score: number;
  grade: "A" | "B" | "C" | "D" | "E";
  summary: string;
  highlights: string[];
} {
  if (!foods.length) {
    return {
      score: 0,
      grade: "E",
      summary: "No hay alimentos para evaluar.",
      highlights: ["Sin datos"]
    };
  }

  const totalCalories = foods.reduce((acc, food) => acc + food.nutrition.calories, 0);
  const weighted = foods.reduce((acc, food) => {
    const health = evaluateFoodHealthScore(food);
    const weight = totalCalories > 0 ? food.nutrition.calories / totalCalories : 1 / foods.length;
    return acc + health.score * weight;
  }, 0);

  const roundedScore = Math.round(clamp(weighted, 0, 100));
  const grade = healthGradeFromScore(roundedScore);
  const highlights = summarizeHealthHighlights(foods);
  return {
    score: roundedScore,
    grade,
    summary: mealHealthSummary(grade),
    highlights
  };
}

function healthGradeFromScore(score: number): "A" | "B" | "C" | "D" | "E" {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 35) return "D";
  return "E";
}

function mealHealthSummary(grade: "A" | "B" | "C" | "D" | "E"): string {
  if (grade === "A") return "Muy buena calidad nutricional para esta comida.";
  if (grade === "B") return "Buena calidad nutricional con margen pequeno de mejora.";
  if (grade === "C") return "Calidad intermedia: revisa porciones y composicion.";
  if (grade === "D") return "Calidad baja: conviene reducir azucar o ultraprocesados.";
  return "Calidad muy baja: intenta alternativas mas naturales y densas en nutrientes.";
}

function summarizeHealthHighlights(foods: DetectedFood[]): string[] {
  const tags = new Set<string>();
  for (const food of foods) {
    const evaluated = evaluateFoodHealthScore(food);
    for (const reason of evaluated.reasons) tags.add(reason);
  }
  if (!tags.size) tags.add("Perfil equilibrado");
  return [...tags].slice(0, 3);
}

function pickDisplayName(a: string, b: string): string {
  const normA = normalizeFoodKey(a);
  const normB = normalizeFoodKey(b);
  if (normB.length > normA.length) return b;
  return a;
}

function toTitleCase(input: string): string {
  return input
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function buildDailyInsight(today: NutritionInfo, goals: Goals): string {
  const kcalRatio = today.calories / Math.max(goals.calories, 1);
  const proteinRatio = today.protein / Math.max(goals.protein, 1);
  const carbsRatio = today.carbs / Math.max(goals.carbs, 1);
  const fatRatio = today.fat / Math.max(goals.fat, 1);

  if (today.calories === 0) {
    return "Aun no has registrado comida. Empieza con un escaneo para que Sainz.ai ajuste tus macros.";
  }
  if (kcalRatio > 1.1) {
    return "Hoy vas por encima de calorias. Prioriza verduras y proteina magra en la siguiente comida.";
  }
  if (proteinRatio < 0.6 && kcalRatio >= 0.5) {
    return "Vas corto de proteina. Te conviene anadir una fuente proteica en tu siguiente plato.";
  }
  if (carbsRatio > 1.1 && fatRatio < 0.8) {
    return "Carbohidratos altos respecto al objetivo. Equilibra con mas proteina y algo de grasa saludable.";
  }
  if (kcalRatio < 0.55) {
    return "Todavia tienes margen de energia. Manten una comida completa para cerrar el dia sin quedarte corto.";
  }
  return "Buen equilibrio general. Ajusta porciones en +/-10g para afinar el objetivo antes de guardar.";
}

const gramAdjustButtonStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.05)",
  color: "white",
  borderRadius: "0.55rem",
  padding: "0.24rem 0.42rem",
  cursor: "pointer",
  fontSize: "0.73rem",
  fontWeight: 700
};

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
