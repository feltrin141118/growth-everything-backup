import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import OpenAI from 'openai'
import { createServerClient } from '@supabase/auth-helpers-nextjs'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: 'Configuração Supabase ausente.' },
        { status: 500 }
      )
    }
    const cookieStore = cookies()
    const supabaseAuth = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options ?? {})
          )
        },
      },
    })
    const { data: { user } } = await supabaseAuth.auth.getUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Não autorizado. Faça login para continuar.' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { structuredAnalysis, targetMetric, contextId, goal_id: goalIdFromBody, traffic_context } = body

    if (!structuredAnalysis) {
      return NextResponse.json(
        { error: 'Análise estruturada é obrigatória' },
        { status: 400 }
      )
    }

    // goal_id obrigatório: body ou contexto (diagnóstico); aceita UUID (string) ou número; será salvo em experiments.goal_id
    let goal_id: number | string | null =
      goalIdFromBody != null && goalIdFromBody !== ''
        ? typeof goalIdFromBody === 'string' && (goalIdFromBody as string).length > 10 && (goalIdFromBody as string).includes('-')
          ? goalIdFromBody
          : Number(goalIdFromBody)
        : null
    if ((goal_id == null || (typeof goal_id === 'number' && Number.isNaN(goal_id))) && contextId != null) {
      const { data: context } = await supabaseAuth
        .from('contexts')
        .select('goal_id')
        .eq('id', contextId)
        .single()
      if (context?.goal_id != null && context.goal_id !== '') {
        goal_id =
          typeof context.goal_id === 'string' && context.goal_id.length > 10 && context.goal_id.includes('-')
            ? context.goal_id
            : Number(context.goal_id)
      }
    }
    if (goal_id == null || (typeof goal_id === 'number' && Number.isNaN(goal_id))) {
      return NextResponse.json(
        { error: 'É obrigatório informar uma meta (goal_id). Selecione uma Meta Global no Diagnóstico antes de gerar experimentos.' },
        { status: 400 }
      )
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY não configurada' },
        { status: 500 }
      )
    }

    // Se goal_id foi enviado, busca título, métrica e plataforma da meta para a IA
    let goalTitle = ''
    let goalMetric = targetMetric
    let goalPlatform = ''
    if (goal_id) {
      const { data: goal } = await supabaseAuth
        .from('goals')
        .select('title, target_metric, ad_platform')
        .eq('id', goal_id)
        .single()
      if (goal) {
        goalTitle = goal.title ?? ''
        if (goal.target_metric) goalMetric = goal.target_metric
        if ((goal as any).ad_platform) goalPlatform = (goal as any).ad_platform
      }
    }

    // Instrução de persona e idioma (Sistema)
    const systemInstruction =
      'Você é um Gestor de Tráfego Sênior e Estrategista de Growth com 10 anos de experiência em contas de 7 dígitos no Meta Ads, Google Ads e TikTok Ads. Sua missão é analisar um diagnóstico de tráfego e gerar 5 experimentos de alta probabilidade de sucesso para otimizar o ROAS e baixar o CPA. Responda OBRIGATORIAMENTE em Português do Brasil (pt-BR). Nunca responda em inglês, nem misture idiomas.'

    // Monta o prompt da tarefa com diretrizes de especialista e formato de saída
    let taskPrompt = `
Diretrizes de Especialista:

0) Antes de sugerir qualquer coisa, analise o objetivo (goal) e a métrica alvo informada pelo usuário. Entenda claramente o que significa "sucesso" para esse objetivo e qual métrica deve ser otimizada.
1) Foco em Funil: identifique se o problema está no TOFU (Atração/CTR), MOFU (Engajamento/Retenção) ou BOFU (Conversão/Checkout).
2) Linha de Corte (Cutoff): cada experimento deve ter uma linha de corte financeira clara, por exemplo: "Pausar se o CPL ultrapassar R$ X após 500 impressões".
3) Hipóteses Atômicas: nunca sugira apenas "melhorar o criativo". Em vez disso, sugira hipóteses concretas como "Testar um gancho de curiosidade nos primeiros 3 segundos vs um gancho de dor direta".
4) Priorização ICE:
   - Impacto: o quanto isso move o ponteiro do lucro?
   - Confiança: você já viu isso funcionar antes?
   - Facilidade: dá para subir esse teste em 15 minutos?

Comportamento para Objetivos de Tráfego:
- Se o objetivo estiver relacionado a tráfego, mídia paga, campanhas, anúncios ou criativos, deduza você mesmo as métricas relevantes (CPA, CTR, ROAS, CPC, taxa de retenção de vídeo) a partir do contexto e do objetivo, mesmo que o usuário não tenha fornecido números exatos.
- Inclua essas métricas de forma explícita em "metric", em "target" (valor numérico desejado) e no texto da "hypothesis" (ex.: "Elevar o CTR de 1,2% para 2,0%" ou "Reduzir o CPA de R$ 40 para R$ 25").
- Utilize as métricas fornecidas no diagnóstico mais recente (CPA, CTR, etc.) como base quantitativa para definir o "target" e a "cutoff_line" de cada hipótese gerada.

Regras de Linguagem:
- Responda sempre em Português do Brasil (pt-BR).
- Sempre use termos técnicos de tráfego em português do Brasil (ex.: CPA, CTR, criativos, funil, campanhas, conjuntos de anúncios, segmentação).
- Nos campos "title" e "hypothesis", escreva em português e use esse vocabulário técnico de mídia paga.

Formato de Saída (OBRIGATÓRIO):
- Sua resposta deve ser ÚNICA e EXCLUSIVAMENTE um objeto JSON válido. Proibido qualquer texto, explicação ou caractere antes do primeiro { ou depois do último }.
- A estrutura é exatamente: {"strategic_vision": "...", "experiments": [...]}
- "strategic_vision": string em português com a visão estratégica.
- "experiments": array com exatamente 5 objetos. Cada objeto com as chaves: "title", "hypothesis", "metric", "target", "cutoff_line", "ice_score".
- "target": número (integer ou float).
- "ice_score": OBRIGATORIAMENTE número inteiro (ex.: 7 ou 8). Nunca use string ou texto; o sistema rejeita e a inserção no banco falha.
- Não inclua markdown, blocos de código (```) nem comentários. Apenas o JSON puro.
`.trim()

    if (goalTitle) {
      taskPrompt += `\n\nA meta em foco é: "${goalTitle}".`
    }
    if (goalMetric) {
      taskPrompt += `\nA métrica alvo principal é: ${goalMetric}. Use essa métrica para orientar as hipóteses e os targets numéricos.`
    }
    if (goalPlatform) {
      taskPrompt += `\nA plataforma de tráfego pago em foco é: ${goalPlatform}. Adapte os experimentos especificamente para essa plataforma.`
    }

    // Se vier um bloco de métricas quantitativas do diagnóstico, injeta no prompt
    if (traffic_context && typeof traffic_context === 'object') {
      const parts: string[] = []
      if (traffic_context.platform) {
        parts.push(`Plataforma principal (diagnóstico): ${traffic_context.platform}`)
      }
      if (traffic_context.cpa_current) {
        parts.push(`CPA atual (diagnóstico): R$ ${traffic_context.cpa_current}`)
      }
      if (traffic_context.cpa_target) {
        parts.push(`CPA desejado (diagnóstico): R$ ${traffic_context.cpa_target}`)
      }
      if (traffic_context.ctr_current) {
        parts.push(`CTR atual (diagnóstico): ${traffic_context.ctr_current}%`)
      }
      if (traffic_context.daily_test_budget) {
        parts.push(`Orçamento diário de teste (diagnóstico): R$ ${traffic_context.daily_test_budget}`)
      }
      if (parts.length > 0) {
        taskPrompt += `\n\nDados quantitativos do diagnóstico mais recente:\n${parts.join('\n')}`
      }
    }

    // Chama a OpenAI para gerar experimentos
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `${systemInstruction}\n\n${taskPrompt}`,
        },
        {
          role: 'user',
          content: `Contexto estruturado:\n${JSON.stringify(structuredAnalysis, null, 2)}`,
        },
      ],
      response_format: { type: 'json_object' },
    })

    let experimentsJson = completion.choices[0]?.message?.content

    if (!experimentsJson) {
      return NextResponse.json(
        { error: 'Erro ao gerar experimentos da OpenAI' },
        { status: 500 }
      )
    }

    experimentsJson = experimentsJson.trim()
    // Remove markdown code block se existir
    const jsonMatch = experimentsJson.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/m)
    if (jsonMatch) {
      experimentsJson = jsonMatch[1].trim()
    }
    // Extrai apenas o objeto JSON (primeiro { até o último }), ignorando texto antes/depois
    const firstBrace = experimentsJson.indexOf('{')
    const lastBrace = experimentsJson.lastIndexOf('}')
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      experimentsJson = experimentsJson.slice(firstBrace, lastBrace + 1)
    }

    let experimentsParsed: any
    try {
      experimentsParsed = JSON.parse(experimentsJson)
    } catch (parseErr: any) {
      console.error('Resposta da IA não é JSON válido:', experimentsJson?.slice(0, 500))
      return NextResponse.json(
        { error: 'A IA retornou um formato inválido. Tente gerar novamente.' },
        { status: 500 }
      )
    }

    // Espera objeto com strategic_vision e experiments; fallback para array puro
    let experimentsArray: any[] = []
    if (experimentsParsed.experiments && Array.isArray(experimentsParsed.experiments)) {
      experimentsArray = experimentsParsed.experiments
    } else if (Array.isArray(experimentsParsed)) {
      experimentsArray = experimentsParsed
    } else {
      experimentsArray = Object.values(experimentsParsed).filter(
        (exp: any) => exp && typeof exp === 'object'
      )
    }

    experimentsArray = experimentsArray.slice(0, 5)

    const rows = experimentsArray.map((exp: any) => ({
        user_id: user.id,
        hypothesis: exp.hypothesis ?? exp.title ?? '',
        variable: exp.metric ?? '',
        expected_result: exp.target ?? null,
        target_value: exp.target ?? null,
        cutoff_line: exp.cutoff_line ?? null,
        context_id: contextId ?? null,
        goal_id,
        status: 'backlog',
      }
    })

    // goal_id é obrigatório neste ponto; se estiver ausente, aborta antes do insert
    if (goal_id == null || (typeof goal_id === 'number' && Number.isNaN(goal_id))) {
      return NextResponse.json(
        { error: 'goal_id ausente ou inválido ao salvar experimentos.' },
        { status: 400 }
      )
    }

    let saved
    try {
      const { data, error } = await supabaseAuth
        .from('experiments')
        .insert(rows)
        .select()

      if (error) {
        throw error
      }
      saved = data
    } catch (dbError: any) {
      console.error('Erro ao inserir experimentos no Supabase:', dbError)
      return NextResponse.json(
        {
          error:
            dbError?.message ||
            'Erro ao salvar experimentos no banco de dados. Verifique se o goal_id é válido e as chaves estrangeiras estão corretas.',
        },
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        success: true,
        experiments: saved ?? [],
      },
      { status: 200 }
    )
  } catch (error: any) {
    console.error('Erro na API de geração de experimentos:', error)
    
    // Trata erros específicos da OpenAI
    if (error.status === 400) {
      return NextResponse.json(
        {
          error: `Erro na requisição à OpenAI: ${error.message || 'Formato de requisição inválido'}`,
        },
        { status: 400 }
      )
    }
    
    return NextResponse.json(
      {
        error: error.message || 'Erro ao gerar experimentos',
      },
      { status: 500 }
    )
  }
}
