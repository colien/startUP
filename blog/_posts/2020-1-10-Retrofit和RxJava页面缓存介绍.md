---
date: 2020-1-10
tag: 
  - Retrofit
  - blog
  - RxJava
author: colien
location: shenzhen  
---

# Retrofit和RxJava页面缓存介绍


## 一、目标

使用户可以离线查看页面，而不需要手动指定存储数据的方法，自动地管理缓存和加载页面。


## 二、设计思路

传统的缓存是数据库实现，对于每一种实体都要创建DAO，对于每一个Request要实现local()和store()，非常不便于扩展。 Retrofit引入之后，我们希望可以通过缓存JSON来透明的实现页面缓存，而不需要添加额外代码。
最初，我们希望借助OkHttp内部的缓存，添加OkHttp拦截器实现，但是在实际操作中发现使用OkHttp来缓存页面存在一些困难：
  1. 需要服务器支持Cache-Control。
  2. 即使我们可以伪造服务器HTTP Header，我们仍然需要在客户端指定页面的过期时间。
  3. 在OkHttp拦截器中，Retrofit的接口方法信息已经完全丢失，很难为每个请求单独指定缓存策略。
  4. 对于超过了Cache-Control时间的页面仍然无法展示。

## 三、Retrofit简介

对于一个HTTP请求，我们需要声明一个接口：

```java
public interface SomeService {

    @GET("/{path}/some_json.json")
    Observable<SomeResult> getSomething(@Path("path") String path,
                                        @Query("param") String param,
                                        @Query("offset") int offset,
                                        @Query("limit") int limit);
}
```

然后我们可以这样调用：
```java
RestAdapter restAdapter;
SomeService service = restAdapter.create(SomeService.class);
Observable<SomeResult> someResult = service.getSomething(...);
someResult.subsribe(new Subscriber<SomeResult>() {
    onNext(SomeResult someResult), onCompleted(), onError(Throwable t)
)
}
```

:::tip
  注：在Retrofit 2.0中，RestAdapter类不再存在，取而代之的是Retrofit类。
:::

这是极好的！我们不再需要在Request中拼接URL、Header和参数了！

## 四、Retrofit可以返回rx.Observable类型

代理Retrofit返回的Service，我们可以很好地拦截请求和返回数据。利用Java的动态代理和RxJava的Operators我们可以拼装方法返回的对象。利用Annotation，我们可以为每个Service方法分别指定过期时间。

### 缓存策略

我设计了3种常用的缓存策略，PREFER_NETWORK、FORCE_NETWORK和PREFER_CACHE。
  1. FORCE_NETWORK：该策略将会强制从网络加载数据，如果加载成功，将最新的数据保存进缓存，否则抛出异常。
  2. PREFER_NETWORK：该策略将会试图从网络加载数据，如果加载成功，将最新的数据保存进缓存，否则加载缓存中的数据，如果加载缓存失败，则抛出异常。
  3. PREFER_CACHE：该策略将会试图从缓存中加载未过期的缓存，如果加载成功，则直接返回，否则执行PREFER_NETWORK的策略。



### 缓存策略的使用场景

  1. 通常情况下，我们的业务对时间都不是非常敏感的，同一个用户可能在一段时间内多次打开同一个页面。大多数情况下页面的数据没有发生变化，但是用户依然消耗了流量，而且耗费了等待时间。当用户第一次打开某个时间不敏感的页面时，使用PREFER_CACHE。
  2. 当用户手动点击刷新界面的时候，使用PREFER_NETWORK。我们目前的策略全部都是PREFER_NETWORK。
  3. 当某个页面对时间非常敏感，用户必须获知这个页面的最新状态时，使用FORCE_NETWORK。


## 五、Move to Retrofit

  1. 我们对每种返回结果都要定义一个Wrapper类，在其内部定义一个实现JsonSerializer和JsonDeserializer的类，这个类负责将网络返回的json解析成我们需要的格式。
  2. 将Wrapper类和对应的序列化方法放入GsonProvider的静态构造方法中。
  3. 声明一个Service接口，声明方法，声明接口的过期时间为30分钟： @ExpireTime(value = 30, timeUnit = TimeUnit.MINUTES)
  4. 声明Observable和Subscriber RetrofitContext.getInstance(context).preferNetwork(Wrapper.class).subscribe(subsriber());
  5. 我们可以将多个Observable连接起来，并且使用observeOn(Schedulers.io())使下一个Observable运行在IO线程，使用observeOn(AndroidSchedulers.mainThread())使下一个Observable运行在主线程中。这样，我们就可以毫无代价地实现一个页面的分块串行加载。如果中间某一块加载发生异常，异常将会被抛出到最终的Subscriber的onError(Throwable t)中，接下来的页面将不会被加载，我们可以显示一些异常信息。
  6. 删除繁琐的Loader和Request，and enjoy！
一个例子：

``` java
public class MovieListWrapper {

    private final List<Movie> mData;

    private MovieListWrapper(List<Movie> data) {
        this.mData = data;
    }

    public List<Movie> getData() {
        return mData;
    }

    public static class MovieListSerializer implements JsonDeserializer<MovieListWrapper>,
            JsonSerializer<MovieListWrapper> {

        @Override
        public MovieListWrapper deserialize(JsonElement json, Type typeOfT, JsonDeserializationContext context)
                throws JsonParseException {
            JsonArray array = json.getAsJsonObject().get("data").getAsJsonObject().get("hot").getAsJsonArray();
            List<Movie> data = context.deserialize(array, new TypeToken<List<Movie>>() {}.getType());
            return new MovieListWrapper(data);
        }

        @Override
        public JsonElement serialize(MovieListWrapper src, Type typeOfSrc, JsonSerializationContext context) {
            JsonObject data = new JsonObject();
            data.add("hot", context.serialize(src.mData));
            JsonObject ret = new JsonObject();
            ret.add("data", data);
            return ret;
        }
    }
}
```
注：随着请求类型的增加，请求类的个数也会呈现线性增长，这对于减少apk的体积是不利的。不过好在这些类的方法个数比较少，每个类附带的Serializer只有两个方法。


```java
/** 
 * 电影列表Retrofit服务
 */
public interface MovieListService {

    /**
     * 获取热映电影列表
     * @param city   城市代码
     */
    @ExpireTime(value = 1, timeUnit = TimeUnit.HOURS)
    @GET(MovieRetrofitApi.MOVIE_HOTS)
    Observable<MovieListWrapper> getHotMovies(@Query("ct") String city,
                                              @Query("offset") int offset,
                                              @Query("limit") int limit);
}

public class MovieHotsFragment extends PullToRefreshListFragment<List<Movie>, Movie> implements WishClickCallBack.ResetWish {

    @Inject
    private ICityController cityController;

    private MovieListAdapter<Movie> adapter;

    @Override
    public void onActivityCreated(Bundle savedInstanceState) {
        super.onActivityCreated(savedInstanceState);
        // getLoaderManager().initLoader(0, null, this);
        loadData();
    }

    private void loadData() {
        RetrofitContext.getInstance(getActivity())
                .preferCache(MovieListService.class)
                .getHotMovies(cityController.getCityName(), 0, Integer.MAX_VALUE)
                .observeOn(AndroidSchedulers.mainThread())
                .subscribe(subscriber());
    }

    private void refreshData() {
        RetrofitContext.getInstance(getActivity())
                .preferNetwork(MovieListService.class)
                .getHotMovies(cityController.getCityName(), 0, Integer.MAX_VALUE)
                .observeOn(AndroidSchedulers.mainThread())
                .subscribe(subscriber());
    }

    private Subscriber<MovieListWrapper> subscriber() {
        return new Subscriber<MovieListWrapper>() {
            @Override
            public void onCompleted() {
                if (getPullToRefreshView().isRefreshing()) {
                    getPullToRefreshView().onRefreshComplete();
                }
            }

            @Override
            public void onError(Throwable e) {
                setEmptyState(true);
                if (getPullToRefreshView().isRefreshing()) {
                    getPullToRefreshView().onRefreshComplete();
                }
            }

            @Override
            public void onNext(MovieListWrapper wrapper) {
                setListShown(true);
                if (wrapper == null || wrapper.getData().isEmpty()) {
                    setEmptyState(false);
                    return;
                }
                adapter = new MovieHotListAdapter(getActivity());
                adapter.setResetWish(MovieHotsFragment.this);
                adapter.setData(wrapper.getData());
                setListAdapter(adapter);
            }
        };
    }

    ...
}
```
注：RetrofitContext类内部已经使用RetrofitAdapter类屏蔽了Retrofit 1.X和Retrofit 2.X的接口差异，现在，我们的项目可以平滑地迁移到Retrofit 2.0了。
注：Retrofit 2.0目前还是beta版本。

## 六、带来的额外好处

  1. 减少用户流量消耗（缓存命中时不需要访问网络）
  2. 提高页面加载速度（不需要等内容全部传输完毕就可以显示第一块内容，如果缓存中有数据不需要访问网络）
  3. 减少电量消耗（移动网络使用次数大大降低）
  4. 增加页面加载成功率（即使网络加载失败，仍然会加载缓存中的内容）
 

## 七、遗憾
  1. 我们不得不为每个API定义一个Wrapper类，在其内部定义一个实现JsonSerializer和JsonDeserializer的类。我们必须为每一个Wrapper定义它的序列化和反序列化方法，这是因为json的形式各种各样，甚至它的物理结构和我们需要的逻辑结构是不同的。这样做可以增加序列化的灵活性，同时也可以为每个Wrapper类实现更高效的序列化方法。
  2. 如果数据是从网络上加载的，那么我们为了存储数据，需要额外一次序列化。
  3. 非关系型的存储结构不能关联数据逻辑。每个页面存储相互独立，导致数据的一致性降低。
  4. 存储的数据对于外界是只读的，难以人工修改。
  5. DiskLruCache是不可靠的，我们的缓存随时可能被替换出存储，所以不适合存储重要信息。
  6. 对于复杂的可选参数列表（比如筛选条件），我们还需要指定额外的绑定参数的方法。

## 八、迁移至Retrofit + RxJava的额外事项
   我们的基类目前还是采取封装Loader和Request的方式，这种方式对于RxJava来讲就不适用了。我们需要为RxJava定义单独的BaseActivity和BaseFragment，对于复杂的页面，应该规定分块串行加载的规则。
