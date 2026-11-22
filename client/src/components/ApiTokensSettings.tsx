import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import api from "../api";
import { copyToClipboard } from "../utils/copyToClipboard";

const permissions = {
  "diagnostics:read": "Читать журнал ротации и очистки",
  "rotation:retry": "Повторять ротацию инбаунда",
  "cleanup:retry": "Повторять очистку",
  "inbounds:repair": "Менять параметры и запускать точечную ротацию",
};
type Permission = keyof typeof permissions;

interface TokenRecord {
  id: string;
  name: string;
  expiresAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
  scopes: Permission[];
}

const tokenPath = "/settings/api-tokens";
const formatDate = (date: string) => new Date(date).toLocaleString("ru-RU");

export function ApiTokensSettings() {
  const [tokens, setTokens] = useState<TokenRecord[]>([]);
  const [name, setName] = useState("");
  const [days, setDays] = useState("30");
  const [scopes, setScopes] = useState<Permission[]>(["diagnostics:read"]);
  const [issued, setIssued] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let mounted = true;
    api
      .get<TokenRecord[]>(tokenPath)
      .then(({ data }) => {
        if (mounted) setTokens(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (mounted) setError("Не удалось загрузить API-токены");
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function issue() {
    setBusy(true);
    setError("");
    setIssued("");
    setCopied(false);
    try {
      const { data } = await api.post<TokenRecord & { token: string }>(
        tokenPath,
        {
          name: name.trim(),
          expiresInDays: Number(days),
          scopes,
        },
      );
      const { token, ...record } = data;
      setIssued(token);
      setTokens((current) => [record, ...current]);
      setName("");
    } catch {
      setError("Не удалось выпустить токен");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(token: TokenRecord) {
    setBusy(true);
    setError("");
    try {
      await api.delete(`${tokenPath}/${token.id}`);
      setTokens((current) =>
        current.map((item) =>
          item.id === token.id
            ? { ...item, revokedAt: new Date().toISOString() }
            : item,
        ),
      );
    } catch {
      setError("Не удалось отозвать токен");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Paper
      className="workspace-panel workspace-settings-section"
      sx={{ maxWidth: 760 }}
    >
      <Stack spacing={2}>
        <Typography variant="h6">API-токены</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        <Stack
          component="form"
          spacing={1}
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && name.trim() && scopes.length) void issue();
          }}
        >
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <TextField
              label="Имя токена"
              required
              value={name}
              size="small"
              onChange={(event) => setName(event.target.value)}
              slotProps={{ htmlInput: { maxLength: 80 } }}
            />
            <TextField
              label="Срок, дней"
              required
              type="number"
              value={days}
              size="small"
              onChange={(event) => setDays(event.target.value)}
              slotProps={{ htmlInput: { min: 1, max: 365 } }}
            />
          </Stack>
          <Stack>
            {(Object.keys(permissions) as Permission[]).map((permission) => (
              <FormControlLabel
                key={permission}
                label={permissions[permission]}
                control={
                  <Checkbox
                    size="small"
                    checked={scopes.includes(permission)}
                    onChange={(_, checked) =>
                      setScopes((current) =>
                        checked
                          ? [...current, permission]
                          : current.filter((value) => value !== permission),
                      )
                    }
                  />
                }
              />
            ))}
          </Stack>
          <Button
            type="submit"
            variant="contained"
            sx={{ alignSelf: "flex-start" }}
            disabled={busy || !name.trim() || !scopes.length}
          >
            Выпустить токен
          </Button>
        </Stack>
        {issued && (
          <Stack spacing={1}>
            <TextField
              label="Секрет показывается один раз"
              value={issued}
              fullWidth
              slotProps={{ input: { readOnly: true } }}
            />
            <Button
              onClick={() =>
                void copyToClipboard(issued)
                  .then(() => setCopied(true))
                  .catch(() => setError("Не удалось скопировать токен"))
              }
            >
              {copied ? "Скопировано" : "Скопировать токен"}
            </Button>
          </Stack>
        )}
        {tokens.map((token) => (
          <Stack
            key={token.id}
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            alignItems="flex-start"
            spacing={1}
            sx={{ borderTop: 1, borderColor: "divider", pt: 1 }}
          >
            <Stack>
              <Typography fontWeight={600}>{token.name}</Typography>
              <Typography variant="caption">
                {token.scopes.map((scope) => permissions[scope]).join(" · ")}
              </Typography>
              <Typography variant="caption">
                {token.revokedAt
                  ? `Отозван ${formatDate(token.revokedAt)}`
                  : `Действует до ${formatDate(token.expiresAt)}`}
                {token.lastUsedAt
                  ? ` · Последнее использование ${formatDate(token.lastUsedAt)}`
                  : ""}
              </Typography>
            </Stack>
            {!token.revokedAt && (
              <Button
                color="error"
                size="small"
                disabled={busy}
                onClick={() => void revoke(token)}
              >
                Отозвать
              </Button>
            )}
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}
