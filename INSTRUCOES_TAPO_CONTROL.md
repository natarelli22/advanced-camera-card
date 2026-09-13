# Instruções para a Conversa "Sincronização Lenta Câmera Tapo"

Este documento contém as orientações e trechos de código exatos para copiar e colar na conversa **"Sincronização Lenta Câmera Tapo"** (ou no repositório `HomeAssistant-Tapo-Control`), permitindo que a integração forneça o **Cold Storage Path** dinamicamente para o **Advanced Camera Card**.

---

## 1. Resumo do Ajuste Necessário

O `advanced-camera-card` agora obtém o caminho de armazenamento das gravações diretamente dos atributos fornecidos pela integração `HomeAssistant-Tapo-Control` no Home Assistant:
- Se o Cold Storage Path estiver em `/media` (ex: `/media/tapo/Sala_02`, `/media/Sala_02`, etc.), o card consulta diretamente a mídia local (`media-source://media_source/local/...`), eliminando completamente as chamadas lentas para `media-source://tapo_control`.
- Se o Cold Storage Path estiver no padrão da integração (`/config/.storage/tapo_control/{entry_id}`), o card consulta a integração.

Para garantir que o `advanced-camera-card` descubra o caminho de qualquer câmera imediatamente ao iniciar:
1. **No `switch.py`**: O switch `Media Sync` (`switch.<camera>_media_sync`) deve definir o atributo `storage_path` logo na inicialização (`__init__`), além do `updateTapo`.
2. **No `camera.py`**: A entidade da câmera (`camera.<camera>_hd_stream`) deve expor o atributo `storage_path` em `_attr_extra_state_attributes`.
3. **No `media_source.py`**: A busca de gravações deve usar `getColdDirPathForEntry(self.hass, entry_id)` como padrão quando o usuário não configurar um caminho personalizado no options flow.

---

## 2. Alteração 1: `custom_components/tapo_control/switch.py`

No arquivo `custom_components/tapo_control/switch.py`, localize a classe `TapoEnableMediaSyncSwitch` (por volta da linha 344):

```python
class TapoEnableMediaSyncSwitch(TapoSwitchEntity):
    def __init__(
        self,
        entry: dict,
        hass: HomeAssistant,
        config_entry,
        entry_storage: Store,
        savedValue: bool,
    ):
        self._attr_extra_state_attributes = {}
        # ADICIONAR ESTA LINHA para que storage_path esteja disponível imediatamente:
        self._attr_extra_state_attributes["storage_path"] = getColdDirPathForEntry(
            hass, config_entry.entry_id
        )
        TapoSwitchEntity.__init__(
            self,
            "Media Sync",
            entry,
            hass,
            config_entry,
            "mdi:sync",
        )
        self._entry_storage = entry_storage
        self._attr_state = "on" if savedValue else "off"
        entry[ENABLE_MEDIA_SYNC] = savedValue
```

---

## 3. Alteração 2: `custom_components/tapo_control/camera.py`

No arquivo `custom_components/tapo_control/camera.py`, certifique-se de importar `getColdDirPathForEntry`:

```python
from .utils import (
    # ... outros imports
    getColdDirPathForEntry,
)
```

E no método `updateTapo` de `TapoRTSPCamEntity` (ou em seu `__init__`), adicionar o atributo `storage_path`:

```python
        # Em updateTapo ou __init__:
        self._attr_extra_state_attributes["storage_path"] = getColdDirPathForEntry(
            self._hass, self._config_entry.entry_id
        )
```

Dessa forma, qualquer cliente (inclusive o `advanced-camera-card`) pode inspecionar `state.attributes['storage_path']` diretamente na própria câmera.

---

## 4. Alteração 3: `custom_components/tapo_control/media_source.py`

No método `_get_cameras()` de `custom_components/tapo_control/media_source.py`, garantir que:
1. `getColdDirPathForEntry(self.hass, entry_id)` seja usado como fallback quando `conf_entry.data.get(MEDIA_SYNC_COLD_STORAGE_PATH)` for vazio.
2. `Path("/config/.storage/tapo_control")` seja incluído em `base_candidates`.

Trecho no `_get_cameras()`:
```python
        for entry_id, entry_data in ha_entries.items():
            name = entry_data.get("name")
            conf_entry = entry_data.get("entry")
            if not name:
                continue

            safe_key = (
                re.sub(r"[^A-Za-z0-9._-]+", "_", name.strip()).strip("._") or "camera"
            )
            cam_path: Path | None = None

            # 1. Primeiro verifica se há caminho customizado configurado
            if conf_entry:
                cold_path = conf_entry.data.get(MEDIA_SYNC_COLD_STORAGE_PATH)
                if cold_path and os.path.exists(cold_path):
                    cam_path = Path(cold_path)

            # 2. Se não houver caminho customizado, usa o cold path padrão da integração
            if not cam_path and conf_entry:
                default_cold = getColdDirPathForEntry(self.hass, entry_id)
                if default_cold and os.path.exists(default_cold):
                    cam_path = Path(default_cold)

            # 3. Se ainda não encontrado, busca em diretórios comuns de mídia
            if not cam_path:
                cam_path = _find_disk_dir(name, safe_key)

            if not cam_path:
                for base in [
                    Path("/media/tapo"),
                    Path("/media/tapo_care"),
                    Path("/config/.storage/tapo_control"),
                    Path("/media"),
                ]:
                    cand1 = base / name
                    cand2 = base / safe_key
                    cand3 = base / safe_key.lower()
                    if cand1.is_dir():
                        cam_path = cand1
                        break
                    if cand2.is_dir():
                        cam_path = cand2
                        break
                    if cand3.is_dir():
                        cam_path = cand3
                        break

            if not cam_path:
                default_cold = getColdDirPathForEntry(self.hass, entry_id)
                cam_path = Path(default_cold)

            try:
                mapped_disk_paths.add(cam_path.resolve())
            except Exception:
                mapped_disk_paths.add(cam_path)

            key = cam_path.name if cam_path.exists() else safe_key
            cameras[key] = {
                "title": name,
                "path": cam_path,
                "entry_id": entry_id,
                "child_id": None,
                "storage_path": str(cam_path),
            }
```

---

## 5. Como o Advanced Camera Card Consome Esse Caminho

1. Ao carregar uma câmera Tapo, o card lê `cameraEntity.attributes.storage_path` ou `mediaSyncSwitch.attributes.storage_path`.
2. Se o caminho for em `/media` (ex: `/media/tapo/Sala_02`):
   - O card consulta `media-source://media_source/local/tapo/Sala_02` diretamente via Home Assistant WebSocket.
   - Navega na pasta `videos/` ou pastas de data e reproduz os vídeos `.mp4` instantaneamente pelo servidor HTTP de mídia do Home Assistant.
   - **`media-source://tapo_control` nunca é chamado**, evitando qualquer travamento ou download lento da câmera física.
3. Se o caminho for `/config/.storage/tapo_control/{entry_id}` ou não estiver em `/media`:
   - O card consulta `media-source://tapo_control`.
