'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClientComponentClient } from '@/lib/supabase-client'
import { Lightbulb, Gauge, TrendingUp, Target, Trash2, Brain, Pencil } from 'lucide-react'

interface Experiment {
  id: number
  hypothesis?: string
  variable?: string
  current_value?: string | number
  expected_result?: string | number
  status?: string
  [key: string]: any
}

export default function GerarExperimentos() {
  const router = useRouter()
  const supabase = createClientComponentClient()
  const [loadingExperiments, setLoadingExperiments] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [backlogExperiments, setBacklogExperiments] = useState<Experiment[]>([])
  const [lastDiagnosis, setLastDiagnosis] = useState<any>(null)
  const [currentCycle, setCurrentCycle] = useState<number>(1)
  const [updatingId, setUpdatingId] = useState<number | null>(null)
  const [savedToBacklogId, setSavedToBacklogId] = useState<number | null>(null)
  const [editingCardId, setEditingCardId] = useState<number | null>(null)
  const [cardDraft, setCardDraft] = useState<{ hypothesis: string; variable: string; expected_result: string; cutoff_line: string }>({
    hypothesis: '',
    variable: '',
    expected_result: '',
    cutoff_line: '',
  })
  const [savingCard, setSavingCard] = useState(false)

  const getSuggestedCutoff = (expected: string | number | null | undefined): string => {
    if (expected == null || expected === '') return ''
    const s = String(expected).trim()
    const match = s.match(/([+-]?\d+(?:[.,]\d+)?)\s*%?/)
    if (!match) return ''
    const num = parseFloat(match[1].replace(',', '.'))
    if (Number.isNaN(num)) return ''
    const half = num * 0.5
    if (s.includes('%')) return `${half}%`
    return String(half)
  }

  const openEditCard = (exp: Experiment) => {
    setEditingCardId(exp.id)
    const expectedStr = exp.expected_result != null && exp.expected_result !== '' ? String(exp.expected_result) : ''
    const cutoff = exp.cutoff_line ?? exp.min_to_validate
    const cutoffStr = cutoff != null && cutoff !== '' ? String(cutoff) : getSuggestedCutoff(exp.expected_result)
    setCardDraft({
      hypothesis: exp.hypothesis ?? '',
      variable: exp.variable ?? '',
      expected_result: expectedStr,
      cutoff_line: cutoffStr,
    })
  }

  const cancelEditCard = () => {
    setEditingCardId(null)
    setCardDraft({ hypothesis: '', variable: '', expected_result: '', cutoff_line: '' })
  }

  const handleSaveCardEdit = async (expId: number) => {
    setSavingCard(true)
    try {
      const hypothesis = cardDraft.hypothesis.trim() || null
      const variable = cardDraft.variable.trim() || null
      const expected_result = cardDraft.expected_result.trim() || null
      const cutoff_line = cardDraft.cutoff_line.trim() || null

      const { error: err } = await supabase
        .from('experiments')
        .update({
          hypothesis,
          variable,
          expected_result,
          target_value: expected_result,
          cutoff_line,
        })
        .eq('id', expId)

      if (err) throw err

      setExperiments((prev) =>
        prev.map((e) =>
          e.id === expId
            ? { ...e, hypothesis: hypothesis ?? undefined, variable: variable ?? undefined, expected_result: expected_result ?? undefined, cutoff_line: cutoff_line ?? undefined }
            : e
        )
      )
      setBacklogExperiments((prev) =>
        prev.map((e) =>
          e.id === expId
            ? { ...e, hypothesis: hypothesis ?? undefined, variable: variable ?? undefined, expected_result: expected_result ?? undefined, cutoff_line: cutoff_line ?? undefined }
            : e
        )
      )
      cancelEditCard()
    } catch (err: any) {
      console.error('Erro ao salvar edição do card:', err)
    } finally {
      setSavingCard(false)
    }
  }

  useEffect(() => {
    fetchLastDiagnosis()
    fetchBacklogExperiments()
  }, [])

  useEffect(() => {
    if (!lastDiagnosis?.goal_id) {
      setCurrentCycle(1)
      return
    }
    supabase
      .from('goals')
      .select('current_cycle')
      .eq('id', lastDiagnosis.goal_id)
      .single()
      .then(({ data }) => {
        setCurrentCycle(data?.current_cycle != null ? Number(data.current_cycle) : 1)
      })
  }, [lastDiagnosis?.goal_id])

  const fetchLastDiagnosis = async () => {
    try {
      await supabase.auth.getSession()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setError('Faça login para carregar o diagnóstico.')
        return
      }

      const { data, error: supabaseError } = await supabase
        .from('contexts')
        .select('id, raw_input, structured_analysis, goal_id, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (supabaseError) {
        throw supabaseError
      }

      if (!data) {
        console.log('Nenhum diagnóstico encontrado para o usuário: ' + user.id)
        setLastDiagnosis(null)
        return
      }

      setLastDiagnosis(data)

      if (data.goal_id != null && data.goal_id !== '') {
        const { data: goal } = await supabase
          .from('goals')
          .select('id, title, current_cycle')
          .eq('id', data.goal_id)
          .single()
        if (!goal) {
          console.warn('Meta associada ao diagnóstico não encontrada. goal_id:', data.goal_id)
        }
      }
    } catch (err: any) {
      console.error('Erro ao buscar diagnóstico:', err)
      setError('Erro ao carregar último diagnóstico')
    }
  }

  /** Busca no Supabase apenas experimentos com status = 'backlog' (próximos da fila) */
  const fetchBacklogExperiments = async (excludeIds: number[] = []) => {
    try {
      const { data, error: supabaseError } = await supabase
        .from('experiments')
        .select('*')
        .eq('status', 'backlog')
        .order('created_at', { ascending: false })

      if (supabaseError) {
        throw supabaseError
      }

      const filtered = (data || []).filter(
        (exp: any) => !excludeIds.includes(exp.id),
      )
      setBacklogExperiments(filtered)
    } catch (err) {
      console.error('Erro ao buscar próximos da fila (backlog):', err)
    }
  }

  const generateExperiments = async () => {
    if (!lastDiagnosis?.structured_analysis) {
      setError('Nenhum diagnóstico encontrado. Por favor, crie um diagnóstico primeiro.')
      return
    }
    const goalId = lastDiagnosis.goal_id
    if (goalId == null || goalId === undefined || goalId === '') {
      setError('Nenhuma meta selecionada no diagnóstico. No Cockpit de Entrada, selecione uma Meta Global antes de analisar e depois gere os experimentos.')
      return
    }

    setLoadingExperiments(true)
    setError(null)
    setExperiments([])

    try {
      let structuredAnalysis: any = lastDiagnosis.structured_analysis
      try {
        structuredAnalysis = JSON.parse(lastDiagnosis.structured_analysis)
      } catch {
        // Se o diagnóstico antigo não estiver em JSON, usamos o texto bruto
        structuredAnalysis = lastDiagnosis.structured_analysis
      }
      const trafficContext = (structuredAnalysis as any)?._traffic_context ?? null

      const response = await fetch('/api/generate-experiments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          structuredAnalysis,
          contextId: lastDiagnosis.id,
          goal_id: goalId,
          traffic_context: trafficContext,
        }),
      })

      const text = await response.text()
      let data: { error?: string; experiments?: Experiment[] } = {}
      try {
        data = text ? JSON.parse(text) : {}
      } catch {
        setError(
          response.ok
            ? 'Resposta da API em formato inválido.'
            : `Erro no servidor (${response.status}). Verifique o console do servidor e se OPENAI_API_KEY e Supabase estão configurados.`
        )
        return
      }

      if (!response.ok) {
        throw new Error(data.error || `Erro ${response.status} ao gerar experimentos`)
      }

      const saved = (data.experiments || []) as Experiment[]
      setExperiments(saved)
      await fetchBacklogExperiments(saved.map((e) => e.id))
    } catch (err: any) {
      setError(err?.message || 'Erro ao gerar experimentos')
    } finally {
      setLoadingExperiments(false)
    }
  }

  /** Escolher como ativo: status 'active', mantém context_id, redireciona para o Dashboard */
  const setExperimentActive = async (experiment: Experiment) => {
    if (!experiment.id) return
    setUpdatingId(experiment.id)
    setError(null)

    try {
      const updatePayload: Record<string, unknown> = { status: 'em_execucao' }
      if (experiment.context_id != null) {
        updatePayload.context_id = experiment.context_id
      }
      const { error: supabaseError } = await supabase
        .from('experiments')
        .update(updatePayload)
        .eq('id', experiment.id)

      if (supabaseError) {
        throw supabaseError
      }

      setExperiments((prev) => prev.filter((e) => e.id !== experiment.id))
      setBacklogExperiments((prev) => prev.filter((e) => e.id !== experiment.id))
      router.refresh()
      window.location.href = '/'
    } catch (err: any) {
      setError(err.message || 'Erro ao atualizar experimento')
    } finally {
      setUpdatingId(null)
    }
  }

  /** Mover para esteira: status 'backlog', mantém context_id, remove o card e mostra aviso */
  const moveToEsteira = async (experiment: Experiment) => {
    if (!experiment.id) return
    setUpdatingId(experiment.id)
    setError(null)
    setSavedToBacklogId(null)

    try {
      const updatePayload: Record<string, unknown> = { status: 'backlog' }
      if (experiment.context_id != null) {
        updatePayload.context_id = experiment.context_id
      }
      const { error: supabaseError } = await supabase
        .from('experiments')
        .update(updatePayload)
        .eq('id', experiment.id)

      if (supabaseError) {
        throw supabaseError
      }

      const remainingTopIds = experiments
        .filter((e) => e.id !== experiment.id)
        .map((e) => e.id)
      setExperiments((prev) => prev.filter((e) => e.id !== experiment.id))
      setSavedToBacklogId(experiment.id)
      setTimeout(() => setSavedToBacklogId(null), 3000)
      await fetchBacklogExperiments(remainingTopIds)
    } catch (err: any) {
      setError(err.message || 'Erro ao mover para esteira')
    } finally {
      setUpdatingId(null)
    }
  }

  const archiveExperiment = async (experiment: Experiment) => {
    if (!experiment.id) return
    setUpdatingId(experiment.id)
    setError(null)

    try {
      const { error: supabaseError } = await supabase
        .from('experiments')
        .update({ status: 'archived' })
        .eq('id', experiment.id)

      if (supabaseError) {
        throw supabaseError
      }

      setExperiments((prev) => prev.filter((e) => e.id !== experiment.id))
      setBacklogExperiments((prev) =>
        prev.filter((e) => e.id !== experiment.id),
      )
    } catch (err: any) {
      setError(err.message || 'Erro ao arquivar experimento')
    } finally {
      setUpdatingId(null)
    }
  }

  const getStatusBadge = (status: string) => {
    if (status === 'active') {
      return (
        <span className="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/40 px-2.5 py-1 text-xs font-medium text-blue-800 dark:text-blue-200">
          Ativo
        </span>
      )
    }
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/40 px-2.5 py-1 text-xs font-medium text-amber-800 dark:text-amber-200">
        Backlog
      </span>
    )
  }

  return (
    <main className="min-h-screen flex flex-col items-center px-4 bg-slate-50 dark:bg-slate-900 py-12">
      <div className="w-full max-w-6xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl mb-2">
            Gerar Experimentos
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            Com base no último diagnóstico, gere experimentos estruturados. Todos são salvos em backlog; escolha um para ativar.
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200/80 dark:border-red-800/50 p-4">
            <p className="text-sm font-medium text-red-800 dark:text-red-200">
              {error}
            </p>
          </div>
        )}

        {savedToBacklogId && (
          <div className="mb-6 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200/80 dark:border-emerald-800/50 p-4">
            <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
              Salvo no Backlog
            </p>
          </div>
        )}

        {lastDiagnosis ? (
          <div className="mb-6 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200/80 dark:border-emerald-800/50 p-4">
            <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
              Último diagnóstico carregado com sucesso
            </p>
          </div>
        ) : (
          <div className="mb-6 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200/80 dark:border-amber-800/50 p-4">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              Nenhum diagnóstico encontrado. Crie um diagnóstico primeiro.
            </p>
          </div>
        )}

        {/* Visão Estratégica do Ciclo — strategic_overview ou strategic_analysis da IA */}
        {lastDiagnosis?.structured_analysis && (() => {
          let strategicText = ''
          let hasPoucaInformacao = false
          try {
            const parsed = JSON.parse(lastDiagnosis.structured_analysis)
            strategicText =
              (typeof parsed.strategic_overview === 'string' ? parsed.strategic_overview.trim() : '') ||
              (typeof parsed.strategic_analysis === 'string' ? parsed.strategic_analysis.trim() : '')
            hasPoucaInformacao =
              strategicText.length > 0 &&
              (/pouca informação/i.test(strategicText) || /faltam dados/i.test(strategicText))
          } catch {
            strategicText = ''
          }
          if (!strategicText) return null
          return (
            <section className="mb-8">
              <div
                className={`rounded-xl border p-6 bg-slate-50 dark:bg-slate-800/80 ${
                  hasPoucaInformacao
                    ? 'border-amber-400 dark:border-amber-500'
                    : 'border-slate-200/80 dark:border-slate-700'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <Brain className="h-5 w-5 text-slate-600 dark:text-slate-400 shrink-0" aria-hidden />
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                    Visão Estratégica do Ciclo
                  </h2>
                  <span className="inline-flex items-center rounded-md bg-slate-200/80 dark:bg-slate-600 px-2.5 py-0.5 text-xs font-medium text-slate-700 dark:text-slate-200">
                    Ciclo #{currentCycle}
                  </span>
                </div>
                <div className="prose prose-sm dark:prose-invert max-w-none text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                  {strategicText}
                </div>
              </div>
            </section>
          )
        })()}

        <div className="mb-8 flex justify-center">
          <button
            onClick={generateExperiments}
            disabled={loadingExperiments || !lastDiagnosis}
            className="rounded-xl bg-brand-600 px-8 py-3 text-base font-medium text-white shadow-sm hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loadingExperiments ? 'Gerando e salvando...' : 'Gerar Experimentos'}
          </button>
        </div>

        {experiments.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {experiments.map((experiment) => {
              const isEditingCard = editingCardId === experiment.id
              const suggestedCutoff = getSuggestedCutoff(experiment.expected_result)
              const cutoffDisplay = (experiment.cutoff_line ?? experiment.min_to_validate) != null && String(experiment.cutoff_line ?? experiment.min_to_validate) !== ''
                ? String(experiment.cutoff_line ?? experiment.min_to_validate)
                : (suggestedCutoff ? `${suggestedCutoff} (sugerido)` : '—')
              return (
              <div
                key={experiment.id}
                className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200/80 dark:border-slate-700 p-6 flex flex-col"
              >
                <div className="flex items-start justify-between gap-3 mb-4">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white leading-tight">
                    {experiment.hypothesis || `Experimento #${experiment.id}`}
                  </h3>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditCard(experiment)}
                      className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-600 dark:hover:text-slate-200"
                      aria-label="Editar"
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </button>
                    {getStatusBadge(experiment.status || 'backlog')}
                  </div>
                </div>

                {isEditingCard ? (
                  <div className="space-y-2 flex-1">
                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Título / Hipótese</label>
                    <input
                      type="text"
                      value={cardDraft.hypothesis}
                      onChange={(e) => setCardDraft((c) => ({ ...c, hypothesis: e.target.value }))}
                      className="w-full rounded-md border border-slate-300 bg-white dark:bg-slate-700 px-2.5 py-1.5 text-sm text-slate-900 dark:text-slate-100"
                    />
                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Métrica</label>
                    <input
                      type="text"
                      value={cardDraft.variable}
                      onChange={(e) => setCardDraft((c) => ({ ...c, variable: e.target.value }))}
                      className="w-full rounded-md border border-slate-300 bg-white dark:bg-slate-700 px-2.5 py-1.5 text-sm text-slate-900 dark:text-slate-100"
                    />
                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Resultado Esperado</label>
                    <input
                      type="text"
                      value={cardDraft.expected_result}
                      onChange={(e) => setCardDraft((c) => ({ ...c, expected_result: e.target.value }))}
                      placeholder="Ex: +20%"
                      className="w-full rounded-md border border-slate-300 bg-white dark:bg-slate-700 px-2.5 py-1.5 text-sm text-slate-900 dark:text-slate-100"
                    />
                    <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Linha de Corte Sugerida</label>
                    <input
                      type="text"
                      value={cardDraft.cutoff_line}
                      onChange={(e) => setCardDraft((c) => ({ ...c, cutoff_line: e.target.value }))}
                      placeholder="Mínimo para não ser fracasso (ex: +10%)"
                      className="w-full rounded-md border border-slate-300 bg-white dark:bg-slate-700 px-2.5 py-1.5 text-sm text-slate-900 dark:text-slate-100"
                    />
                    <div className="flex gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => handleSaveCardEdit(experiment.id)}
                        disabled={savingCard}
                        className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                      >
                        {savingCard ? 'Salvando...' : 'Salvar'}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditCard}
                        className="rounded-lg border border-slate-300 bg-white dark:bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                <>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                  <span className="font-medium">Linha de Corte Sugerida:</span> {cutoffDisplay}
                </p>
                <div className="space-y-4 flex-1">
                  {experiment.hypothesis && (
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center">
                        <Lightbulb className="w-4 h-4 text-brand-600 dark:text-brand-400" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">
                          Hipótese
                        </p>
                        <p className="text-sm text-slate-700 dark:text-slate-300">
                          {experiment.hypothesis}
                        </p>
                      </div>
                    </div>
                  )}

                  {experiment.variable && (
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                        <Gauge className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">
                          Variável / Métrica
                        </p>
                        <p className="text-sm text-slate-700 dark:text-slate-300">
                          {experiment.variable}
                        </p>
                      </div>
                    </div>
                  )}

                  {(experiment.current_value !== undefined && experiment.current_value !== null && experiment.current_value !== '') && (
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                        <Target className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">
                          Valor Atual
                        </p>
                        <p className="text-sm text-slate-700 dark:text-slate-300">
                          {String(experiment.current_value)}
                        </p>
                      </div>
                    </div>
                  )}

                  {(experiment.expected_result !== undefined && experiment.expected_result !== null && experiment.expected_result !== '') && (
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                        <TrendingUp className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">
                          Resultado Esperado
                        </p>
                        <p className="text-sm text-slate-700 dark:text-slate-300">
                          {String(experiment.expected_result)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-6">
                  {!isEditingCard && (experiment.status || 'backlog') === 'backlog' && (
                    <>
                      <button
                        onClick={() => setExperimentActive(experiment)}
                        disabled={updatingId === experiment.id}
                        className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {updatingId === experiment.id ? 'Atualizando...' : 'Escolher este Experimento'}
                      </button>
                      <button
                        onClick={() => moveToEsteira(experiment)}
                        disabled={updatingId === experiment.id}
                        className="mt-2 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {updatingId === experiment.id ? 'Movendo...' : 'Mover para Esteira'}
                      </button>
                    </>
                  )}
                  {(experiment.status || '') === 'active' && (
                    <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200/80 dark:border-emerald-800/50 px-4 py-2.5 text-center">
                      <span className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                        Experimento ativo
                      </span>
                    </div>
                  )}
                </div>
                </>
                )}
              </div>
            )
            })}
          </div>
        )}

        {!loadingExperiments && experiments.length === 0 && lastDiagnosis && (
          <div className="text-center py-12 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700">
            <p className="text-slate-600 dark:text-slate-400">
              Clique em &quot;Gerar Experimentos&quot; para criar e salvar 3 experimentos no backlog.
            </p>
          </div>
        )}

        {/* Próximos da Fila / Esteira — select apenas status = 'backlog' */}
        <div className="mt-10">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-1">
            Próximos da Fila
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            Esteira — experimentos guardados para executar no futuro (status: backlog)
          </p>
          {backlogExperiments.length === 0 ? (
            <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 py-6 px-4 text-center">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Nenhum experimento em backlog no momento.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900">
              <div className="min-w-full divide-y divide-slate-200/80 dark:divide-slate-800">
                <div className="grid grid-cols-[1fr,minmax(0,0.8fr),auto] items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <span>Hipótese</span>
                  <span className="hidden sm:block truncate">Métrica</span>
                  <span className="text-right">Ações</span>
                </div>
                {backlogExperiments.map((experiment) => (
                  <div
                    key={experiment.id}
                    className="grid grid-cols-[1fr,minmax(0,0.8fr),auto] items-center gap-2 px-3 py-2.5 text-sm text-slate-700 dark:text-slate-200"
                  >
                    <div className="min-w-0">
                      <span className="font-medium truncate block" title={experiment.hypothesis || ''}>
                        {experiment.hypothesis || `Experimento #${experiment.id}`}
                      </span>
                    </div>
                    <div className="hidden sm:block text-xs text-slate-500 dark:text-slate-400 truncate" title={experiment.variable || ''}>
                      {experiment.variable || '—'}
                    </div>
                    <div className="flex items-center justify-end gap-1.5 shrink-0">
                      <button
                        onClick={() => setExperimentActive(experiment)}
                        disabled={updatingId === experiment.id}
                        className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {updatingId === experiment.id ? '...' : 'Escolher'}
                      </button>
                      <button
                        onClick={() => archiveExperiment(experiment)}
                        disabled={updatingId === experiment.id}
                        className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white p-1 text-slate-500 hover:bg-slate-50 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label="Arquivar"
                        title="Arquivar"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
