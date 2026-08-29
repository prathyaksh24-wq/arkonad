@echo off
echo ARKONAD_TEST_CHILD_STARTED
echo Working directory: %CD%
echo Press Enter to return with test exit code 23.
set /p "ARKONAD_TEST_REPLY="
exit /b 23
