#Requires AutoHotkey v2.0
#SingleInstance Force
SendMode("Input")

; ================== CONFIG ==================
global API_URL        := "http://localhost:3333/api/translate"
global SRC            := "en"
global TGT            := "pt"
global PRESERVE_LINES := true
; ============================================

; ======= Tray / Menu =======
TraySetIcon()
A_IconTip := "Tradutor Local"
A_TrayMenu.Delete
A_TrayMenu.Add("Traduzir (Ctrl+Alt+T)", (*) => DoReplaceHotkey())
A_TrayMenu.Add("Prévia (Ctrl+Alt+Shift+T)", (*) => DoPreviewHotkey())
A_TrayMenu.Add()
A_TrayMenu.Add("Inverter idiomas (Ctrl+Alt+,)", (*) => ToggleSwap())
A_TrayMenu.Add("Alternar preservar quebras (Ctrl+Alt+.)", (*) => TogglePreserve())
A_TrayMenu.Add()
A_TrayMenu.Add("Sair", (*) => ExitApp())

; ======= Hotkeys =======
^!t::  DoReplaceHotkey()      ; Ctrl+Alt+T → traduz e substitui
^!+t:: DoPreviewHotkey()      ; Ctrl+Alt+Shift+T → prévia
^!,::  ToggleSwap()           ; Ctrl+Alt+, → inverter idiomas
^!.::  TogglePreserve()       ; Ctrl+Alt+. → alternar preservar quebras
^!p::  ShowPayloadHotkey()    ; Ctrl+Alt+P → mostrar JSON a ser enviado

; ======= Ações =======
DoReplaceHotkey() {
    text := GetSelection()
    if (text = "") {
        TrayTip("Tradutor", "Nada selecionado.", 2000)
        return
    }
    trans := Translate(text, SRC, TGT, PRESERVE_LINES)
    if (trans = "") {
        TrayTip("Tradutor", "Erro ao traduzir.", 2000)
        return
    }
    clipBefore := ClipboardAll()   ; salva clipboard
    A_Clipboard := trans
    Send("^v")
    Sleep(100)
    A_Clipboard := clipBefore      ; restaura clipboard
    TrayTip("Tradutor", "Tradução aplicada (" SRC " → " TGT ").", 1500)
}

DoPreviewHotkey() {
    text := GetSelection()
    if (text = "") {
        TrayTip("Tradutor", "Nada selecionado.", 2000)
        return
    }
    trans := Translate(text, SRC, TGT, PRESERVE_LINES)
    if (trans = "") {
        TrayTip("Tradutor", "Erro ao traduzir.", 2000)
        return
    }
    ShowPreview(text, trans)
}

ToggleSwap() {
    tmp := SRC, SRC := TGT, TGT := tmp
    TrayTip("Tradutor", "Idiomas: " SRC " → " TGT, 1500)
}

TogglePreserve() {
    PRESERVE_LINES := !PRESERVE_LINES
    TrayTip("Tradutor", (PRESERVE_LINES ? "Preservar" : "Não preservar") " quebras.", 1500)
}

; ======= Utilidades =======
GetSelection() {
    clipBefore := ClipboardAll()
    A_Clipboard := ""
    Send("^c")
    if !ClipWait(0.8) {
        Sleep(150)
        Send("^c")
        if !ClipWait(0.8) {
            A_Clipboard := clipBefore
            return ""
        }
    }
    text := A_Clipboard
    A_Clipboard := clipBefore
    return text
}

; --------- ENVIO HTTP + PARSE RESPOSTA ----------
Translate(text, src, tgt, preserveLines := true) {
    payload := BuildJson(text, src, tgt, preserveLines)

    ; Cliente HTTP robusto: envia string com charset utf-8
    try {
        http := ComObject("MSXML2.ServerXMLHTTP.6.0")
    } catch {
        http := ComObject("MSXML2.XMLHTTP")
    }
    http.Open("POST", API_URL, false)
    http.setRequestHeader("Content-Type", "application/json; charset=utf-8")
    http.send(payload)

    if (http.status != 200)
        return ""

    resp := http.responseText

    ; ==== PARSE ROBUSTO (AJUSTE) ====
    ; Padrão para capturar "best":"<...>" aceitando \" e \n (multilinha)
    ; Em AHK v2, aspas literais dentro da string -> use "" para cada ".
    pattern := """best"":""((?:\\\\.|[^""\\\\])*)"""
    m := RegExMatch(resp, pattern)      ; retorna objeto Match ou 0
    if (!m)
        return ""

    s := m[1]                           ; 1º grupo

    ; Desescapes essenciais do JSON p/ colagem Windows
    s := StrReplace(s, '\"', '"')       ; \"  -> "
    s := StrReplace(s, '\\\\', '\')     ; \\  -> \
    s := StrReplace(s, '\r', '')        ; \r  -> (remove)
    s := StrReplace(s, '\n', "`r`n")    ; \n  -> CRLF
    return s
}

; --------- JSON SEGURO (sem Format) ----------
BuildJson(text, src, tgt, preserveLines) {
    jText := JsonEscape(text)
    jSrc  := JsonEscape(src)
    jTgt  := JsonEscape(tgt)
    jPres := preserveLines ? "true" : "false"

    json := "{"
    json .= '"text":"' jText '",'
    json .= '"src":"'  jSrc  '",'
    json .= '"tgt":"'  jTgt  '",'
    json .= '"preserveLines":' jPres ','
    json .= '"log":true,'
    json .= '"origin":"hotkey"'
    json .= "}"
    return json
}

JsonEscape(s) {
    s := StrReplace(s, '\', '\\')   ; \  -> \\
    s := StrReplace(s, '"', '\"')   ; "  -> \"
    s := StrReplace(s, '`r', '')    ; remove CR
    s := StrReplace(s, '`n', '\n')  ; LF real -> \n literal no JSON
    return s
}

; --------- DEBUG: visualizar payload ----------
ShowPayloadHotkey() {
    text := GetSelection()
    if (text = "") {
        TrayTip("Tradutor", "Nada selecionado.", 2000)
        return
    }
    payload := BuildJson(text, SRC, TGT, PRESERVE_LINES)

    g := Gui("+AlwaysOnTop +Resize +MinSize400x200")
    g.SetFont("s10", "Consolas")
    g.Add("Text",, "Payload → " API_URL)
    g.Add("Edit", "w720 r12 ReadOnly", payload)
    g.Add("Button", "w120", "Copiar").OnEvent("Click", (*) => (A_Clipboard := payload, TrayTip("Tradutor","Payload copiado.",1200)))
    g.Add("Button", "x+10 w120", "Fechar").OnEvent("Click", (*) => g.Destroy())
    g.Title := "Debug: JSON a enviar"
    g.Show()
}

; --------- UI de prévia ----------
ShowPreview(src, tgt) {
    g := Gui("+AlwaysOnTop +Resize +MinSize400x200")
    g.SetFont("s10","Segoe UI")
    g.Add("Text",, "Original:")
    g.Add("Edit","w700 r10 ReadOnly", src)
    g.Add("Text",, "Tradução:")
    edit := g.Add("Edit","w700 r10", tgt)
    g.Add("Button","w100","Copiar").OnEvent("Click", (*) => (A_Clipboard := edit.Value, TrayTip("Tradutor","Copiado.",1200)))
    g.Add("Button","x+10 w100","Fechar").OnEvent("Click", (*) => g.Destroy())
    g.Title := "Prévia (" SRC " → " TGT ")"
    g.Show()
}
