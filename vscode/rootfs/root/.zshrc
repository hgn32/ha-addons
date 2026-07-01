export ZSH="$HOME/.oh-my-zsh"

ZSH_THEME="robbyrussell"

DISABLE_AUTO_UPDATE="true"
COMPLETION_WAITING_DOTS="true"

plugins=(
    extract
    git
    nmap
    pip
    python
    rsync
    zsh-autosuggestions
    zsh-syntax-highlighting
)

source $ZSH/oh-my-zsh.sh

alias reset-settings="cp /root/.code-server/settings.json /data/vscode/User/settings.json && echo 'Settings reset to defaults'"

# Home Assistant CLI shell completions
source <(ha completion bash)

# Show message of the day
cat /etc/motd
