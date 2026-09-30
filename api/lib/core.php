<?php

final class ApiError extends Exception
{
    public int $status;
    // Machine-readable reason the front can react to (e.g. 'pricing_outdated'); null for plain errors.
    public ?string $errorCode;

    public function __construct(int $status, string $message, ?string $errorCode = null)
    {
        parent::__construct($message);
        $this->status = $status;
        $this->errorCode = $errorCode;
    }
}

function app_config(): array
{
    static $config = null;
    if ($config === null) {
        $config = require dirname(__DIR__) . '/config.php';
    }
    return $config;
}

function json_response(int $status, array $payload): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=UTF-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(int $status, string $message, ?string $errorCode = null): void
{
    throw new ApiError($status, $message, $errorCode);
}

function read_json_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        fail(400, 'Requisição inválida (JSON malformado).');
    }
    return $data;
}

function now_iso(): string
{
    return gmdate('Y-m-d\TH:i:s\Z');
}

function client_ip(): string
{
    return $_SERVER['REMOTE_ADDR'] ?? 'unknown';
}

function is_https(): bool
{
    if (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off') {
        return true;
    }
    // HostGator e outros provedores atrás de proxy informam o protocolo original neste cabeçalho.
    return strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
}

function str_field($value, int $maxLength): string
{
    $text = trim((string) ($value ?? ''));
    return mb_substr($text, 0, $maxLength, 'UTF-8');
}

function num_field($value, float $min = 0.0): float
{
    $number = is_numeric($value) ? (float) $value : 0.0;
    return is_finite($number) ? max($number, $min) : $min;
}

function register_error_handlers(): void
{
    set_exception_handler(function (Throwable $e) {
        if ($e instanceof ApiError) {
            $payload = ['success' => false, 'message' => $e->getMessage()];
            if ($e->errorCode !== null) {
                $payload['code'] = $e->errorCode;
            }
            json_response($e->status, $payload);
        }
        error_log('[portal-api] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
        $message = app_config()['debug'] ? $e->getMessage() : 'Erro interno no servidor. Tente novamente em instantes.';
        json_response(500, ['success' => false, 'message' => $message]);
    });

    set_error_handler(function (int $severity, string $message, string $file, int $line) {
        if (!(error_reporting() & $severity)) {
            return false;
        }
        throw new ErrorException($message, 0, $severity, $file, $line);
    });
}
