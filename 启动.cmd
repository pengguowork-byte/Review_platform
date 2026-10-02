@echo off
chcp 65001 >nul
title Knowledge Review
setlocal
set "APP_DIR=%~dp0"
set "NODE_EXE=%APP_DIR%runtime\node.exe"
if not exist "%NODE_EXE%" (
    where node >nul 2>nul
    if errorlevel 1 (
        echo [ERROR] Node.js not found. Please restore runtime\node.exe.
        pause
        exit /b 1
    )
    set "NODE_EXE=node"
)
"%NODE_EXE%" "%APP_DIR%scripts\launch.cjs" %1
if errorlevel 1 pause
