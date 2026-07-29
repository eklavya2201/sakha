@echo off
cd /d "%~dp0"
start "Sakha server" cmd /k npm start
start "Sakha tunnel" cmd /k ngrok http --url=reid-mediatorial-noncreditably.ngrok-free.dev 3005
echo Server + tunnel starting in two windows.
echo Webhook URL: https://reid-mediatorial-noncreditably.ngrok-free.dev/webhook
