-- Banco de dados do Desaperto (Cloudflare D1).
-- Rodar uma vez, no console do D1: cole este arquivo inteiro e execute.

CREATE TABLE IF NOT EXISTS respostas (
  id          TEXT PRIMARY KEY,          -- identificador interno (aleatório)
  protocolo   TEXT NOT NULL UNIQUE,      -- código curto mostrado para a pessoa
  chave_hash  TEXT NOT NULL,             -- hash da chave que permite à própria pessoa corrigir as respostas
  criado_em   TEXT NOT NULL,             -- ISO 8601, UTC
  atualizado_em TEXT NOT NULL,
  nome        TEXT,
  email       TEXT,
  teste       INTEGER NOT NULL DEFAULT 0,-- 1 = enviado no modo de teste
  status      TEXT NOT NULL DEFAULT 'recebido', -- recebido | gerando | plano_pronto | erro_plano | plano_enviado
  plano_enviado_em TEXT,
  plano_gerado_em TEXT,
  plano_resumo TEXT,                     -- JSON com data de saída, avisos e se precisa de revisão
  plano_erro  TEXT,
  origem_hash TEXT,                      -- hash do IP + sal, só para limitar abuso
  dados       TEXT NOT NULL              -- respostas completas, em JSON
);

CREATE INDEX IF NOT EXISTS idx_respostas_criado ON respostas (criado_em);
CREATE INDEX IF NOT EXISTS idx_respostas_origem ON respostas (origem_hash, criado_em);

-- Para um banco criado antes destas colunas existirem:
-- ALTER TABLE respostas ADD COLUMN plano_gerado_em TEXT;
-- ALTER TABLE respostas ADD COLUMN plano_resumo TEXT;
-- ALTER TABLE respostas ADD COLUMN plano_erro TEXT;
