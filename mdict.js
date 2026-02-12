define('mdict-parseXml', function() {
  return function (str) {
      return (new DOMParser()).parseFromString(str, 'text/xml');
    }
});

require(['jquery', 'mdict-common', 'mdict-parser', 'mdict-renderer', 'selectize'], function($, MCommon, MParser, MRenderer, Selectize) {
  
  // 🔴 配置区：请修改为你的在线 MDX 文件名
  var REMOTE_DICT_URL = 'dict.mdx'; 

  // 初始化 selectize
  var $selectize = $('#word').selectize({maxItems: 1});
  var selectizeControl = $selectize[0].selectize;
  
  // 隐藏原有的文件输入框（因为它不再被需要了）
  $('#dictfile').hide();
  
  // 在页面上找个地方显示状态
  var $status = $('<div id="loading-status" style="margin:10px 0; padding:10px; background:#e8f0fe; border-radius:4px;">⏳ Initializing...</div>');
  $('#dictfile').after($status);

  // 禁用查询按钮，直到加载完成
  $('#btnLookup').attr('disabled', true);


  // --- 新增：核心逻辑封装 ---
  function initMdict(fileList) {
    $('#btnLookup').addClass('stripes');
    $('#word').on('keyup', function(e) { e.which === 13 && $('#btnLookup').click(); });

    MParser(fileList).then(function(resources) {
      var mdict = MRenderer(resources);
      
      $status.html('✅ <b>Dictionary Loaded!</b> ' + (resources['mdx'] || resources['mdd']).value().description.substring(0, 50) + '...');
      $('#btnLookup').removeClass('stripes');

      function doSearch(phrase, offset) {
          console.log('Searching: ' + phrase);
          mdict.lookup(phrase, offset).then(function($content) {
            $('#definition').empty().append($content.contents());
            
            // 滚动到顶部
            window.scrollTo(0, 0);
          });
      }
      
      // 显示词典标题
      $('#dict-title').html((resources['mdx'] || resources['mdd']).value().description || '** no description **');
      mdict.render($('#dict-title'));
      
      // 激活按钮
      $('#btnLookup')
        .attr('disabled', false)
        .off('.#mdict')
        .on('click.#mdict', function() {
          var val = $('#word').val();
          if(val) doSearch(val);
        });
      
      // 重置 Selectize
      selectizeControl.destroy();
      
      $('#word').selectize({
          plugins: ['restore_on_backspace'],
          maxItems: 1,
          maxOptions: 1 << 20,
          valueField: 'value',
          labelField: 'word',
          searchField: 'word',
          delimiter: '~~',
          loadThrottle: 10,
          create: function(v, callback) {
            return callback({word: v, value: v});
          },
          createOnBlur: true,
          closeAfterSelect: true,
          allowEmptyOption: true,
          score: function(search) {
            return function(item) { return 1; };
          },
          load: function(query, callback) {
            var self = this;
            if (!query.length) {
              this.clearOptions();
              this.refreshOptions();
              return;
            };
            
            mdict.search({phrase: query, max: 50}).then(function(list) { // max改小点提高性能
              var options = list.map(function(v) {
                return {word: v, value: v.offset}; // 这里的 value 可能需要根据 mdict-parser 的实际返回结构调整
              });
              self.clearOptions();
              callback(options);
            });
          },
          onChange: function(value) {
             // value 可能是用户输入的字符串（create模式）或者 offset 对象
             // 这里逻辑稍微有点乱，原代码似乎假设 value 是 offset 或者单词
             // 我们简单处理：如果是对象则取 offset，如果是字符串则搜索字符串
             // 但 Selectize 的 valueField 是 'value'
             
             // 获取选中的 item 数据
             var item = this.options[value]; 
             if (item) {
                 doSearch(item.word, item.value); // 传入 offset 以便快速定位
                 $('#word').val(item.word);
             } else {
                 // 可能是用户直接输入回车的情况
                 if(value) doSearch(value); 
             }
          },
        });
    });
  }


  // --- 新增：自动下载逻辑 ---
  function loadRemoteDict() {
      $status.html("⬇️ Downloading dictionary: " + REMOTE_DICT_URL + " ...");
      
      fetch(REMOTE_DICT_URL)
        .then(function(response) {
            if (!response.ok) throw new Error("Download failed: " + response.status);
            
            var contentLength = response.headers.get('content-length');
            var total = parseInt(contentLength, 10);
            var loaded = 0;

            var reader = response.body.getReader();
            return new ReadableStream({
                start: function(controller) {
                    function push() {
                        reader.read().then(function(result) {
                            if (result.done) {
                                controller.close();
                                return;
                            }
                            loaded += result.value.length;
                            if(total) {
                                $status.html("⬇️ Downloading... " + Math.round(loaded/total*100) + "%");
                            }
                            controller.enqueue(result.value);
                            push();
                        });
                    }
                    push();
                }
            });
        })
        .then(function(stream) {
            return new Response(stream).blob();
        })
        .then(function(blob) {
            // 转换为 File 对象
            var file = new File([blob], REMOTE_DICT_URL);
            
            $status.html("⚡ Parsing dictionary index...");
            
            // 调用核心逻辑，传入包含这一个文件的数组
            initMdict([file]);
        })
        .catch(function(err) {
            console.error(err);
            $status.html('<span style="color:red">❌ Error: ' + err.message + '</span><br>请检查 dict.mdx 是否存在且大小写正确');
        });
  }

  // --- 启动 ---
  // 页面加载后立即执行下载
  loadRemoteDict();
  
  // 处理页面内的跳转链接
  $('#definition').on('click', 'a', function(e) {
      var href = $(this).attr('href');
      if (href && href.substring(0, 8) === 'entry://') {
        var word = href.substring(8);
        if (word.charAt(0) !== '#') {
          word = word.replace(/(^[/\\])|([/]$)/, '');
          // 更新 selectize
          var selectize = $('#word')[0].selectize;
          selectize.setValue(word); 
          // 触发查询 (onChange 会处理，或者手动触发)
          // 简单起见，如果 selectize onChange 没触发，手动点一下按钮
          // $('#btnLookup').click(); 
        } 
        return false;
      }
    });

});

// 辅助函数保持不变
var saveData = (function() {
  return function(data, fileName, type) {
    var a = document.createElement("a");
    document.body.appendChild(a);
    a.style = "display: none";
    var blob = new Blob([data], { type: type || "octet/stream" });
    a.href = window.URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    setTimeout(function() {
      window.URL.revokeObjectURL(a.href);
      document.body.removeChild(a);
    }, 500);
  };
}());
