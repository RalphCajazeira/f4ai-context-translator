from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Optional, Dict
import os, requests

USE_TRANSFORMERS = True
try:
    from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer
    import torch
except Exception:
    USE_TRANSFORMERS = False

app = FastAPI(title="MT Service: LLM (Ollama) + M2M100 fallback")

MODEL_NAME = "facebook/m2m100_418M"
if USE_TRANSFORMERS:
    tokenizer = M2M100Tokenizer.from_pretrained(MODEL_NAME)
    model = M2M100ForConditionalGeneration.from_pretrained(MODEL_NAME)
    device = "cuda" if 'torch' in globals() and torch.cuda.is_available() else "cpu"
    model.to(device)

class MTReq(BaseModel):
    text: str
    src: Optional[str] = "en"
    tgt: Optional[str] = "pt"

@app.post("/translate")
def translate(req: MTReq):
    if not USE_TRANSFORMERS:
        return {"text": req.text}
    tokenizer.src_lang = req.src
    encoded = tokenizer(req.text, return_tensors="pt")
    if 'torch' in globals():
        encoded = encoded.to(device)
    generated = model.generate(**encoded, forced_bos_token_id=tokenizer.get_lang_id(req.tgt), max_new_tokens=512)
    out = tokenizer.batch_decode(generated, skip_special_tokens=True)[0]
    return {"text": out}

class LLMShot(BaseModel):
    src: str
    tgt: str

class LLMReq(BaseModel):
    text: str
    src: Optional[str] = "en"
    tgt: Optional[str] = "pt"
    shots: List[LLMShot] = []
    glossary: List[Dict[str, str]] = []

def build_prompt(text: str, src: str, tgt: str, shots: List[LLMShot], glossary: List[Dict[str,str]]) -> str:
    lines = []
    lines.append("Você é um tradutor profissional de jogos (Fallout 4).")
    lines.append(f"Traduza do {src} para {tgt} com naturalidade e consistência; preserve placeholders e formatação.")
    lines.append("Regra IMPORTANTE: mantenha as QUEBRAS DE LINHA exatamente como no texto de entrada, inclusive linhas vazias no início, meio e fim. Não mescle nem remova linhas.")
    if glossary:
        lines.append("Use obrigatoriamente estas traduções de termos:")
        for g in glossary[:50]:
            lines.append(f"- {g.get('term_source','')} => {g.get('term_target','')}")
    if shots:
        lines.append("Exemplos (aprendidos) — NÃO repita esses trechos na resposta final:")
        for idx, s in enumerate(shots[:5], start=1):
            lines.append(f"### Exemplo {idx}")
            lines.append("SRC:\n```\n" + s.src + "\n```")
            lines.append("TGT:\n```\n" + s.tgt + "\n```")
    lines.append("Texto a traduzir (copie o layout de linhas):")
    lines.append("```\n" + text + "\n```")
    lines.append("Responda apenas com a tradução do trecho acima, mantendo exatamente as mesmas quebras de linha e sem acrescentar exemplos, observações ou traduções extras.")
    return "\n".join(lines)


@app.post("/llm-translate")
def llm_translate(req: LLMReq):
    ollama_url = os.environ.get("OLLAMA_URL","http://localhost:11434")
    model = os.environ.get("OLLAMA_MODEL","qwen2.5:7b-instruct")
    prompt = build_prompt(req.text, req.src, req.tgt, req.shots, req.glossary)
    r = requests.post(f"{ollama_url}/api/generate", json={"model": model, "prompt": prompt, "stream": False}, timeout=120)
    if r.status_code != 200:
        return {"text": req.text}
    out = r.json().get("response","").strip()
    return {"text": out}
